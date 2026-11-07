import os
from unittest.mock import patch

from django.contrib.auth import authenticate
from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings

from accounts.models import User
from clinic.models import (
    CareTask, CRMLead, EmailCampaign, Invoice, MedicalRecord, Medicine, Patient,
    Prescription, TreatmentPlan, TreatmentSession, Visit,
)
from core.models import Booking, Conversation


class MinimalDemoSeedTests(TestCase):
    def setUp(self):
        self.users = []
        for index, role in enumerate(User.Role.values):
            user = User.objects.create_user(
                username=f'minimal-demo-{index}',
                password=f'unchanged-password-{index}',
                role=role,
                first_name=f'Demo {role}',
            )
            self.users.append(user)

    def test_seed_is_idempotent_and_preserves_all_role_accounts(self):
        before = list(User.objects.order_by('pk').values_list('username', 'password', 'role', 'is_active'))
        call_command('seed_minimal_demo')
        call_command('seed_minimal_demo')

        self.assertEqual(
            list(User.objects.order_by('pk').values_list('username', 'password', 'role', 'is_active')),
            before,
        )
        for index, user in enumerate(self.users):
            authenticated = authenticate(username=user.username, password=f'unchanged-password-{index}')
            self.assertIsNotNone(authenticated)
            self.assertEqual(authenticated.pk, user.pk)
        self.assertEqual(Patient.objects.count(), 5)
        self.assertEqual(Medicine.objects.count(), 5)
        self.assertEqual(Booking.objects.count(), 5)
        self.assertEqual(Visit.objects.count(), 5)
        self.assertEqual(MedicalRecord.objects.count(), 4)
        self.assertEqual(Prescription.objects.count(), 3)
        self.assertEqual(CRMLead.objects.count(), 3)
        self.assertEqual(Conversation.objects.count(), 3)
        self.assertEqual(CareTask.objects.count(), 3)
        self.assertEqual(EmailCampaign.objects.count(), 3)
        self.assertEqual(Invoice.objects.count(), 3)
        self.assertEqual(TreatmentPlan.objects.count(), 3)
        self.assertEqual(TreatmentSession.objects.count(), 10)
        active = TreatmentPlan.objects.get(status=TreatmentPlan.ACTIVE)
        self.assertEqual(active.sessions.filter(status=TreatmentSession.DONE).count(), 2)
        self.assertEqual(active.sessions.filter(status=TreatmentSession.PENDING).count(), 3)
        self.assertFalse(Prescription.objects.exclude(visit__record__status=MedicalRecord.SIGNED).exists())
        self.assertEqual(
            set(Invoice.objects.values_list('status', flat=True)),
            {Invoice.UNPAID, Invoice.PARTIAL, Invoice.PAID},
        )

    @override_settings(DEBUG=True)
    def test_reset_is_rejected_outside_the_marked_compose_mysql_database(self):
        with patch.dict(os.environ, {'AKINA_DEMO_RESET_ALLOWED': '1'}):
            with self.assertRaises(CommandError):
                call_command('seed_minimal_demo', reset=True)
        self.assertEqual(User.objects.count(), len(self.users))
        self.assertEqual(Patient.objects.count(), 0)
