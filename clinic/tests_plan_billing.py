from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import CashierShift, Invoice, InvoiceItem, Patient, Payment, Refund, TreatmentPlan, TreatmentSession

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class TreatmentPlanBillingTests(APITestCase):
    def setUp(self):
        create_user = lambda username, role: User.objects.create_user(
            username=username, password='pass12345', role=role, first_name=username,
        )
        self.manager = create_user('plan-manager', 'manager')
        self.doctor = create_user('plan-doctor', 'doctor')
        self.cashier = create_user('plan-cashier', 'consultant')
        self.staff = create_user('plan-staff', 'staff')
        self.patient = Patient.objects.create(full_name='Nguyễn Châu', phone='0912345678')
        self.plan = TreatmentPlan.objects.create(
            patient=self.patient,
            doctor=self.doctor,
            title='Liệu trình peel',
            total_sessions=4,
            price=1_400_000,
            status=TreatmentPlan.ACTIVE,
        )
        self.sessions = [
            TreatmentSession.objects.create(plan=self.plan, number=number)
            for number in range(1, 5)
        ]

    def authenticate(self, user):
        token, _ = Token.objects.get_or_create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')

    def collect(self, body, user=None):
        self.authenticate(user or self.cashier)
        return self.client.post(f'/api/clinic/plans/{self.plan.pk}/collect/', body, format='json')

    def test_partial_and_full_collections_share_one_invoice(self):
        partial = self.collect({'mode': 'partial', 'amount': 500_000, 'method': 'transfer'})
        self.assertEqual(partial.status_code, 200, partial.content)
        self.assertEqual(partial.json()['payment']['balance'], 900_000)

        full = self.collect({'mode': 'full', 'method': 'transfer'})
        self.assertEqual(full.status_code, 200, full.content)
        self.assertEqual(full.json()['payment']['state'], 'paid')
        self.assertEqual(Invoice.objects.count(), 1)

        invoice = Invoice.objects.get(treatment_plan=self.plan)
        self.assertEqual((invoice.total, invoice.paid, invoice.items.count()), (1_400_000, 1_400_000, 4))
        self.assertEqual(set(invoice.items.values_list('treatment_session_id', flat=True)),
                         {session.pk for session in self.sessions})
        self.assertEqual(Payment.objects.filter(invoice=invoice).count(), 2)

    def test_collect_by_session_uses_equal_allocation(self):
        first = self.collect({'mode': 'session', 'count': 1, 'method': 'transfer'})
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()['payment']['paid'], 350_000)
        second = self.collect({'mode': 'session', 'count': 2, 'method': 'transfer'})
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()['payment']['paid'], 1_050_000)

    def test_cash_collection_requires_an_open_shift(self):
        denied = self.collect({'mode': 'full', 'method': 'cash'})
        self.assertEqual(denied.status_code, 400)
        CashierShift.objects.create(cashier=self.cashier)
        accepted = self.collect({'mode': 'full', 'method': 'cash'})
        self.assertEqual(accepted.status_code, 200, accepted.content)

    def test_plan_invoice_cannot_be_refunded_or_edited_before_cancellation(self):
        collected = self.collect({'mode': 'full', 'method': 'transfer'})
        self.assertEqual(collected.status_code, 200, collected.content)
        invoice = Invoice.objects.get(treatment_plan=self.plan)

        self.authenticate(self.cashier)
        refund = self.client.post('/api/clinic/refunds/', {
            'invoice': invoice.pk,
            'amount': 100_000,
            'reason': 'Yêu cầu hoàn một phần',
            'method': 'transfer',
        }, format='json')
        self.assertEqual(refund.status_code, 400)
        edit = self.client.patch(f'/api/clinic/invoices/{invoice.pk}/', {
            'discount': 100_000,
        }, format='json')
        self.assertEqual(edit.status_code, 400)

        self.authenticate(self.manager)
        voided = self.client.post(f'/api/clinic/invoices/{invoice.pk}/void/', {
            'reason': 'Hủy hóa đơn liệu trình',
        }, format='json')
        self.assertEqual(voided.status_code, 400)

    def test_only_cashier_roles_can_collect(self):
        response = self.collect({'mode': 'full', 'method': 'transfer'}, user=self.doctor)
        self.assertEqual(response.status_code, 403)
        response = self.collect({'mode': 'full', 'method': 'transfer'}, user=self.staff)
        self.assertEqual(response.status_code, 403)

    def test_cancellation_keeps_used_value_and_limits_refund(self):
        collected = self.collect({'mode': 'full', 'method': 'transfer'})
        self.assertEqual(collected.status_code, 200, collected.content)
        self.sessions[0].status = TreatmentSession.DONE
        self.sessions[0].save(update_fields=['status'])

        self.authenticate(self.doctor)
        cancelled = self.client.post(f'/api/clinic/plans/{self.plan.pk}/cancel/')
        self.assertEqual(cancelled.status_code, 200, cancelled.content)
        payment = cancelled.json()['payment']
        self.assertEqual(
            (payment['total'], payment['paid'], payment['balance'], payment['refundable']),
            (350_000, 1_400_000, 0, 1_050_000),
        )

        invoice = Invoice.objects.get(treatment_plan=self.plan)
        self.authenticate(self.cashier)
        too_much = self.client.post('/api/clinic/refunds/', {
            'invoice': invoice.pk,
            'amount': 1_050_001,
            'reason': 'Hủy gói, hoàn phần chưa sử dụng',
            'method': 'transfer',
        }, format='json')
        self.assertEqual(too_much.status_code, 400)
        refund = self.client.post('/api/clinic/refunds/', {
            'invoice': invoice.pk,
            'amount': 1_050_000,
            'reason': 'Hủy gói, hoàn phần chưa sử dụng',
            'method': 'transfer',
        }, format='json')
        self.assertEqual(refund.status_code, 201, refund.content)

        self.authenticate(self.manager)
        approved = self.client.post(f"/api/clinic/refunds/{refund.json()['id']}/approve/", {}, format='json')
        self.assertEqual(approved.status_code, 200, approved.content)
        self.authenticate(self.cashier)
        completed = self.client.post(
            f"/api/clinic/refunds/{refund.json()['id']}/complete/",
            {'reference': 'refund-transfer'},
            format='json',
        )
        self.assertEqual(completed.status_code, 200, completed.content)
        invoice.refresh_from_db()
        self.assertEqual(invoice.paid, 350_000)

    def test_refund_is_rechecked_when_approved_and_completed(self):
        self.collect({'mode': 'full', 'method': 'transfer'})
        self.sessions[0].status = TreatmentSession.DONE
        self.sessions[0].save(update_fields=['status'])
        self.authenticate(self.doctor)
        self.assertEqual(self.client.post(f'/api/clinic/plans/{self.plan.pk}/cancel/').status_code, 200)

        invoice = Invoice.objects.get(treatment_plan=self.plan)
        stale = Refund.objects.create(
            invoice=invoice,
            amount=1_050_001,
            method=Payment.TRANSFER,
            reason='Stale request exceeding refundable balance',
            requested_by=self.cashier,
        )
        self.authenticate(self.manager)
        approval = self.client.post(f'/api/clinic/refunds/{stale.pk}/approve/', {}, format='json')
        self.assertEqual(approval.status_code, 400)
        stale.status = Refund.APPROVED
        stale.save(update_fields=['status'])

        self.authenticate(self.cashier)
        completion = self.client.post(
            f'/api/clinic/refunds/{stale.pk}/complete/',
            {'reference': 'stale-refund'},
            format='json',
        )
        self.assertEqual(completion.status_code, 400)

    def test_cancellation_preserves_unpaid_balance_for_used_sessions(self):
        collected = self.collect({'mode': 'partial', 'amount': 100_000, 'method': 'transfer'})
        self.assertEqual(collected.status_code, 200, collected.content)
        for session in self.sessions[:2]:
            session.status = TreatmentSession.DONE
            session.save(update_fields=['status'])

        self.authenticate(self.doctor)
        cancelled = self.client.post(f'/api/clinic/plans/{self.plan.pk}/cancel/')
        self.assertEqual(cancelled.status_code, 200, cancelled.content)
        payment = cancelled.json()['payment']
        self.assertEqual((payment['total'], payment['paid'], payment['balance']), (700_000, 100_000, 600_000))
        invoice = Invoice.objects.get(treatment_plan=self.plan)
        self.assertEqual(list(invoice.items.values_list('treatment_session__number', flat=True)), [1, 2])

    def test_cancelled_plan_cannot_collect_more(self):
        self.authenticate(self.doctor)
        self.client.post(f'/api/clinic/plans/{self.plan.pk}/cancel/')
        response = self.collect({'mode': 'full', 'method': 'transfer'})
        self.assertEqual(response.status_code, 400)
