"""Báo cáo quản trị phòng khám. Mỗi báo cáo trả về cùng một cấu trúc để giao diện và file Excel dùng chung:
{title, period, kpis[], charts[], tables[]}."""
from collections import defaultdict
from datetime import date, timedelta
from io import BytesIO

from django.db.models import Avg, Count, DecimalField, ExpressionWrapper, F, Max, Min, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from .models import (CareTask, Invoice, InvoiceItem, Medicine, MedicalRecord, Patient, Payment, StockLot, StockMovement,
                     TreatmentPlan, Visit)

VND, INT, PCT, TEXT, DATE = 'vnd', 'int', 'pct', 'text', 'date'


def col(key, label, typ=TEXT):
    return {'key': key, 'label': label, 'type': typ}


def parse_range(params):
    today = timezone.localdate()
    try:
        d_to = date.fromisoformat(params.get('to')) if params.get('to') else today
        d_from = date.fromisoformat(params.get('from')) if params.get('from') else today.replace(day=1)
    except ValueError:
        d_to, d_from = today, today.replace(day=1)
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    if (d_to - d_from).days > 800:
        d_from = d_to - timedelta(days=800)
    return d_from, d_to


def days(d_from, d_to):
    return [d_from + timedelta(days=i) for i in range((d_to - d_from).days + 1)]


def pct(a, b):
    return round(a * 100 / b, 1) if b else 0


def prev_range(d_from, d_to):
    span = (d_to - d_from).days + 1
    return d_from - timedelta(days=span), d_from - timedelta(days=1)


def delta_hint(cur, prev):
    if not prev:
        return ''
    ch = (cur - prev) * 100 / prev
    return f'{"+" if ch >= 0 else ""}{ch:.1f}% so với kỳ trước'


def user_name(u):
    return (u.get_full_name() or u.username) if u else 'Chưa phân công'


# --------------------------------------------------------------------------- doanh thu
def revenue(d_from, d_to):
    pay = Payment.objects.filter(paid_at__date__range=(d_from, d_to)).exclude(invoice__status=Invoice.VOID)
    inv = Invoice.objects.filter(created_at__date__range=(d_from, d_to)).exclude(status=Invoice.VOID)
    collected = pay.aggregate(s=Sum('amount'))['s'] or 0
    billed = inv.aggregate(s=Sum('total'))['s'] or 0
    n_inv = inv.count()
    debt = sum(max(i.total - i.paid, 0) for i in inv)
    p_from, p_to = prev_range(d_from, d_to)
    prev_col = Payment.objects.filter(paid_at__date__range=(p_from, p_to)).exclude(invoice__status=Invoice.VOID).aggregate(s=Sum('amount'))['s'] or 0
    prev_bill = Invoice.objects.filter(created_at__date__range=(p_from, p_to)).exclude(status=Invoice.VOID).aggregate(s=Sum('total'))['s'] or 0

    by_day_c = {r['d']: r['s'] for r in pay.annotate(d=TruncDate('paid_at')).values('d').annotate(s=Sum('amount'))}
    by_day_b = {r['d']: r['s'] for r in inv.annotate(d=TruncDate('created_at')).values('d').annotate(s=Sum('total'))}
    ds = days(d_from, d_to)

    method_labels = dict(Payment.METHODS)
    methods = [{'method': method_labels.get(r['method'], r['method']), 'amount': r['s'], 'count': r['n']}
               for r in pay.values('method').annotate(s=Sum('amount'), n=Count('id')).order_by('-s')]
    for m in methods:
        m['share'] = pct(m['amount'], collected)

    items = InvoiceItem.objects.filter(invoice__in=inv).annotate(amt=ExpressionWrapper(F('quantity') * F('unit_price'), output_field=DecimalField()))
    kind_labels = dict(InvoiceItem.KINDS)
    svc = [{'name': r['name'], 'kind': kind_labels.get(r['kind'], r['kind']), 'qty': r['q'], 'amount': int(r['s'] or 0)}
           for r in items.values('name', 'kind').annotate(q=Sum('quantity'), s=Sum('amt')).order_by('-s')[:15]]
    total_items = sum(r['amount'] for r in svc) or 1
    for r in svc:
        r['share'] = pct(r['amount'], total_items)
    kinds = [{'kind': kind_labels.get(r['kind'], r['kind']), 'amount': int(r['s'] or 0)} for r in items.values('kind').annotate(s=Sum('amt')).order_by('-s')]

    doc = defaultdict(lambda: {'amount': 0, 'count': 0})
    for i in inv.select_related('visit__doctor'):
        k = user_name(i.visit.doctor) if i.visit_id and i.visit.doctor_id else 'Không gắn bác sĩ'
        doc[k]['amount'] += i.total
        doc[k]['count'] += 1
    doctors = sorted([{'doctor': k, **v} for k, v in doc.items()], key=lambda r: -r['amount'])

    src = defaultdict(lambda: {'amount': 0, 'count': 0})
    for i in inv.select_related('patient'):
        k = i.patient.referral_source or 'Chưa rõ'
        src[k]['amount'] += i.total
        src[k]['count'] += 1
    sources = sorted([{'source': k, **v} for k, v in src.items()], key=lambda r: -r['amount'])

    return {
        'title': 'Báo cáo doanh thu', 'period': [d_from, d_to],
        'kpis': [
            {'label': 'Thực thu', 'value': collected, 'type': VND, 'hint': delta_hint(collected, prev_col), 'tone': 'green'},
            {'label': 'Doanh số (hóa đơn)', 'value': billed, 'type': VND, 'hint': delta_hint(billed, prev_bill)},
            {'label': 'Công nợ phát sinh', 'value': debt, 'type': VND, 'hint': f'{pct(debt, billed)}% doanh số', 'tone': 'red' if debt else ''},
            {'label': 'Số hóa đơn', 'value': n_inv, 'type': INT, 'hint': f'TB {round(billed / n_inv):,}đ / hóa đơn'.replace(',', '.') if n_inv else ''},
        ],
        'charts': [{'id': 'daily', 'type': 'bar', 'title': 'Doanh số và thực thu theo ngày', 'x': [d.strftime('%d/%m') for d in ds],
                    'series': [{'name': 'Doanh số', 'values': [by_day_b.get(d, 0) for d in ds]},
                               {'name': 'Thực thu', 'values': [by_day_c.get(d, 0) for d in ds]}], 'unit': 'vnd'},
                   {'id': 'kinds', 'type': 'pie', 'title': 'Cơ cấu doanh số', 'x': [k['kind'] for k in kinds],
                    'series': [{'name': 'Doanh số', 'values': [k['amount'] for k in kinds]}], 'unit': 'vnd'}],
        'tables': [
            {'id': 'services', 'title': 'Doanh số theo dịch vụ / sản phẩm (trước giảm giá)', 'columns': [col('name', 'Dịch vụ / sản phẩm'), col('kind', 'Nhóm'),
             col('qty', 'Số lượng', INT), col('amount', 'Doanh số', VND), col('share', 'Tỷ trọng', PCT)], 'rows': svc},
            {'id': 'doctors', 'title': 'Doanh số theo bác sĩ', 'columns': [col('doctor', 'Bác sĩ'), col('count', 'Số hóa đơn', INT), col('amount', 'Doanh số', VND)], 'rows': doctors},
            {'id': 'methods', 'title': 'Thực thu theo hình thức thanh toán', 'columns': [col('method', 'Hình thức'), col('count', 'Số giao dịch', INT),
             col('amount', 'Số tiền', VND), col('share', 'Tỷ trọng', PCT)], 'rows': methods},
            {'id': 'sources', 'title': 'Doanh số theo nguồn khách', 'columns': [col('source', 'Nguồn'), col('count', 'Số hóa đơn', INT), col('amount', 'Doanh số', VND)], 'rows': sources},
        ],
    }


# --------------------------------------------------------------------------- lượt khám & bệnh nhân
def visits(d_from, d_to):
    vs = Visit.objects.filter(check_in_at__date__range=(d_from, d_to)).exclude(status=Visit.CANCELLED)
    total = vs.count()
    done = vs.filter(status=Visit.COMPLETED).count()
    cancelled = Visit.objects.filter(check_in_at__date__range=(d_from, d_to), status=Visit.CANCELLED).count()
    first = {r['patient']: r['f'] for r in Visit.objects.exclude(status=Visit.CANCELLED).values('patient').annotate(f=Min('check_in_at'))}
    pids = set(vs.values_list('patient_id', flat=True))
    new_p = sum(1 for p in pids if d_from <= timezone.localtime(first[p]).date() <= d_to)
    returning = len(pids) - new_p
    wait = vs.filter(called_at__isnull=False).aggregate(a=Avg(F('called_at') - F('check_in_at')))['a']
    wait_min = round(wait.total_seconds() / 60) if wait else 0
    by_day = {r['d']: r['n'] for r in vs.annotate(d=TruncDate('check_in_at')).values('d').annotate(n=Count('id'))}
    ds = days(d_from, d_to)
    type_lbl = dict(Visit.TYPES)
    types = [{'type': type_lbl.get(r['visit_type'], r['visit_type']), 'count': r['n']} for r in vs.values('visit_type').annotate(n=Count('id')).order_by('-n')]
    for t in types:
        t['share'] = pct(t['count'], total)
    doc = defaultdict(lambda: {'count': 0, 'done': 0})
    for v in vs.select_related('doctor'):
        k = user_name(v.doctor)
        doc[k]['count'] += 1
        doc[k]['done'] += v.status == Visit.COMPLETED
    doctors = sorted([{'doctor': k, **v} for k, v in doc.items()], key=lambda r: -r['count'])
    diag = [{'code': r['diagnosis_code'] or '—', 'name': r['diagnosis_name'], 'count': r['n']}
            for r in MedicalRecord.objects.filter(status=MedicalRecord.SIGNED, signed_at__date__range=(d_from, d_to)).exclude(diagnosis_name='')
            .values('diagnosis_code', 'diagnosis_name').annotate(n=Count('id')).order_by('-n')[:12]]
    src = defaultdict(int)
    for p in Patient.objects.filter(created_at__date__range=(d_from, d_to)).values_list('referral_source', flat=True):
        src[p or 'Chưa rõ'] += 1
    n_new = sum(src.values())
    sources = sorted([{'source': k, 'count': v, 'share': pct(v, n_new)} for k, v in src.items()], key=lambda r: -r['count'])
    gender_lbl = dict(Patient.GENDERS)
    gender = [{'gender': gender_lbl.get(r['gender'], r['gender']), 'count': r['n']} for r in Patient.objects.filter(id__in=pids).values('gender').annotate(n=Count('id'))]
    ages = defaultdict(int)
    for p in Patient.objects.filter(id__in=pids):
        a = p.age
        ages['Chưa rõ' if a is None else '<18' if a < 18 else '18–25' if a <= 25 else '26–35' if a <= 35 else '36–45' if a <= 45 else '46+'] += 1
    age_rows = [{'band': b, 'count': ages[b]} for b in ['<18', '18–25', '26–35', '36–45', '46+', 'Chưa rõ'] if ages.get(b)]
    return {
        'title': 'Báo cáo lượt khám & bệnh nhân', 'period': [d_from, d_to],
        'kpis': [{'label': 'Lượt khám', 'value': total, 'type': INT, 'hint': f'{done} đã hoàn tất'},
                 {'label': 'Bệnh nhân mới', 'value': new_p, 'type': INT, 'hint': f'{returning} bệnh nhân quay lại', 'tone': 'green'},
                 {'label': 'Tỷ lệ quay lại', 'value': pct(returning, len(pids)), 'type': PCT, 'hint': f'{len(pids)} bệnh nhân khác nhau'},
                 {'label': 'Chờ trung bình', 'value': wait_min, 'type': 'min', 'hint': f'{cancelled} lượt hủy / bỏ về'}],
        'charts': [{'id': 'daily', 'type': 'bar', 'title': 'Lượt khám theo ngày', 'x': [d.strftime('%d/%m') for d in ds],
                    'series': [{'name': 'Lượt khám', 'values': [by_day.get(d, 0) for d in ds]}], 'unit': 'int'},
                   {'id': 'types', 'type': 'pie', 'title': 'Loại lượt khám', 'x': [t['type'] for t in types],
                    'series': [{'name': 'Lượt', 'values': [t['count'] for t in types]}], 'unit': 'int'}],
        'tables': [
            {'id': 'doctors', 'title': 'Lượt khám theo bác sĩ', 'columns': [col('doctor', 'Bác sĩ'), col('count', 'Lượt khám', INT), col('done', 'Hoàn tất', INT)], 'rows': doctors},
            {'id': 'diag', 'title': 'Chẩn đoán thường gặp', 'columns': [col('code', 'ICD-10'), col('name', 'Chẩn đoán'), col('count', 'Số ca', INT)], 'rows': diag},
            {'id': 'sources', 'title': 'Nguồn bệnh nhân mới', 'columns': [col('source', 'Nguồn'), col('count', 'Số bệnh nhân', INT), col('share', 'Tỷ trọng', PCT)], 'rows': sources},
            {'id': 'types', 'title': 'Cơ cấu lượt khám', 'columns': [col('type', 'Loại'), col('count', 'Lượt', INT), col('share', 'Tỷ trọng', PCT)], 'rows': types},
            {'id': 'gender', 'title': 'Giới tính bệnh nhân đến khám', 'columns': [col('gender', 'Giới tính'), col('count', 'Số bệnh nhân', INT)], 'rows': gender},
            {'id': 'age', 'title': 'Độ tuổi bệnh nhân đến khám', 'columns': [col('band', 'Nhóm tuổi'), col('count', 'Số bệnh nhân', INT)], 'rows': age_rows},
        ],
    }


# --------------------------------------------------------------------------- công nợ
def receivables(d_from, d_to):
    today = timezone.localdate()
    open_inv = [i for i in Invoice.objects.exclude(status__in=[Invoice.VOID, Invoice.PAID]).select_related('patient') if i.total > i.paid]
    buckets = {'0–30 ngày': 0, '31–60 ngày': 0, '61–90 ngày': 0, '> 90 ngày': 0}
    by_patient = defaultdict(lambda: {'debt': 0, 'count': 0, 'oldest': None, 'phone': ''})
    rows = []
    for i in open_inv:
        age = (today - timezone.localtime(i.created_at).date()).days
        b = '0–30 ngày' if age <= 30 else '31–60 ngày' if age <= 60 else '61–90 ngày' if age <= 90 else '> 90 ngày'
        bal = i.total - i.paid
        buckets[b] += bal
        d = by_patient[i.patient.full_name]
        d['debt'] += bal
        d['count'] += 1
        d['phone'] = i.patient.phone
        d['oldest'] = max(d['oldest'] or 0, age)
        rows.append({'code': i.code, 'patient': i.patient.full_name, 'date': timezone.localtime(i.created_at).date().isoformat(),
                     'age': age, 'total': i.total, 'paid': i.paid, 'balance': bal, 'bucket': b})
    rows.sort(key=lambda r: -r['age'])
    total_debt = sum(buckets.values())
    top = sorted([{'patient': k, **v} for k, v in by_patient.items()], key=lambda r: -r['debt'])[:15]
    return {
        'title': 'Báo cáo công nợ bệnh nhân', 'period': [today, today],
        'kpis': [{'label': 'Tổng công nợ', 'value': total_debt, 'type': VND, 'tone': 'red' if total_debt else ''},
                 {'label': 'Hóa đơn còn nợ', 'value': len(open_inv), 'type': INT},
                 {'label': 'Bệnh nhân còn nợ', 'value': len(by_patient), 'type': INT},
                 {'label': 'Nợ quá 60 ngày', 'value': buckets['61–90 ngày'] + buckets['> 90 ngày'], 'type': VND, 'hint': f'{pct(buckets["61–90 ngày"] + buckets["> 90 ngày"], total_debt)}% tổng nợ'}],
        'charts': [{'id': 'aging', 'type': 'bar', 'title': 'Tuổi nợ', 'x': list(buckets), 'series': [{'name': 'Công nợ', 'values': list(buckets.values())}], 'unit': 'vnd'}],
        'tables': [
            {'id': 'top', 'title': 'Bệnh nhân nợ nhiều nhất', 'columns': [col('patient', 'Bệnh nhân'), col('phone', 'Điện thoại'), col('count', 'Số hóa đơn', INT),
             col('oldest', 'Nợ lâu nhất (ngày)', INT), col('debt', 'Còn nợ', VND)], 'rows': top},
            {'id': 'invoices', 'title': 'Chi tiết hóa đơn còn nợ', 'columns': [col('code', 'Số hóa đơn'), col('patient', 'Bệnh nhân'), col('date', 'Ngày lập', DATE), col('age', 'Tuổi nợ (ngày)', INT),
             col('total', 'Tổng tiền', VND), col('paid', 'Đã thu', VND), col('balance', 'Còn nợ', VND), col('bucket', 'Nhóm tuổi nợ')], 'rows': rows},
        ],
    }


# --------------------------------------------------------------------------- kho
def inventory(d_from, d_to):
    today = timezone.localdate()
    meds = list(Medicine.objects.filter(is_active=True).order_by('name'))
    value = sum(m.stock * m.cost for m in meds)
    low = [m for m in meds if m.stock <= m.min_stock]
    lots = list(StockLot.objects.filter(quantity__gt=0).select_related('medicine'))
    soon = sorted([l for l in lots if l.expiry_date and l.expiry_date <= today + timedelta(days=90)], key=lambda l: l.expiry_date)
    expired_val = sum(l.quantity * l.unit_cost for l in soon if l.expiry_date < today)
    mv = StockMovement.objects.filter(created_at__date__range=(d_from, d_to))
    kind_lbl = dict(StockMovement.KINDS)
    mv_sum = []
    for r in mv.values('kind').annotate(n=Count('id'), q=Sum('quantity')):
        mv_sum.append({'kind': kind_lbl.get(r['kind'], r['kind']), 'count': r['n'], 'qty': r['q'] or 0})
    used = [{'name': r['medicine__name'], 'unit': r['medicine__unit'], 'qty': -(r['q'] or 0)}
            for r in mv.filter(kind=StockMovement.OUT).values('medicine__name', 'medicine__unit').annotate(q=Sum('quantity')).order_by('q')[:10]]
    stock_rows = [{'code': m.code, 'name': m.name, 'unit': m.unit, 'stock': m.stock, 'min': m.min_stock, 'cost': m.cost, 'value': m.stock * m.cost,
                   'status': 'Sắp hết' if m.stock <= m.min_stock else 'Đủ'} for m in meds]
    stock_rows.sort(key=lambda r: -r['value'])
    return {
        'title': 'Báo cáo tồn kho & xuất nhập', 'period': [d_from, d_to],
        'kpis': [{'label': 'Giá trị tồn kho (giá vốn)', 'value': value, 'type': VND},
                 {'label': 'Mặt hàng', 'value': len(meds), 'type': INT, 'hint': f'{sum(m.stock for m in meds):,} đơn vị tồn'.replace(',', '.')},
                 {'label': 'Dưới mức tối thiểu', 'value': len(low), 'type': INT, 'tone': 'red' if low else ''},
                 {'label': 'Lô hết hạn trong 90 ngày', 'value': len(soon), 'type': INT, 'hint': f'Đã quá hạn: {expired_val:,}đ'.replace(',', '.') if expired_val else '', 'tone': 'amber' if soon else ''}],
        'charts': [{'id': 'top', 'type': 'bar', 'title': 'Giá trị tồn kho — top 10 mặt hàng', 'x': [r['name'] for r in stock_rows[:10]],
                    'series': [{'name': 'Giá trị tồn', 'values': [r['value'] for r in stock_rows[:10]]}], 'unit': 'vnd'}],
        'tables': [
            {'id': 'low', 'title': 'Cần nhập thêm (dưới mức tối thiểu)', 'columns': [col('code', 'Mã'), col('name', 'Thuốc / sản phẩm'), col('stock', 'Tồn', INT), col('min', 'Mức tối thiểu', INT), col('unit', 'Đơn vị')],
             'rows': [{'code': m.code, 'name': m.name, 'stock': m.stock, 'min': m.min_stock, 'unit': m.unit} for m in low]},
            {'id': 'expiry', 'title': 'Lô sắp hết hạn / đã hết hạn', 'columns': [col('name', 'Thuốc / sản phẩm'), col('lot', 'Số lô'), col('expiry', 'Hạn dùng', DATE),
             col('days', 'Còn (ngày)', INT), col('qty', 'Còn lại', INT), col('value', 'Giá trị', VND)],
             'rows': [{'name': l.medicine.name, 'lot': l.lot_no or f'#{l.pk}', 'expiry': l.expiry_date.isoformat(), 'days': (l.expiry_date - today).days,
                       'qty': l.quantity, 'value': l.quantity * l.unit_cost} for l in soon]},
            {'id': 'moves', 'title': 'Tổng hợp biến động kho trong kỳ', 'columns': [col('kind', 'Loại'), col('count', 'Số phát sinh', INT), col('qty', 'Số lượng (±)', INT)], 'rows': mv_sum},
            {'id': 'used', 'title': 'Xuất nhiều nhất trong kỳ', 'columns': [col('name', 'Thuốc / sản phẩm'), col('unit', 'Đơn vị'), col('qty', 'Số lượng xuất', INT)], 'rows': used},
            {'id': 'stock', 'title': 'Bảng tồn kho & giá trị', 'columns': [col('code', 'Mã'), col('name', 'Thuốc / sản phẩm'), col('unit', 'Đơn vị'), col('stock', 'Tồn', INT),
             col('cost', 'Giá vốn', VND), col('value', 'Giá trị tồn', VND), col('status', 'Tình trạng')], 'rows': stock_rows},
        ],
    }


# --------------------------------------------------------------------------- chăm sóc & liệu trình
def care(d_from, d_to):
    today = timezone.localdate()
    ts = CareTask.objects.filter(due_date__range=(d_from, d_to))
    total = ts.count()
    done = ts.filter(status=CareTask.DONE).count()
    overdue = ts.filter(status=CareTask.PENDING, due_date__lt=today).count()
    kind_lbl = dict(CareTask.KINDS)
    kinds = [{'kind': kind_lbl.get(r['kind'], r['kind']), 'total': r['n'], 'done': r['d']}
             for r in ts.values('kind').annotate(n=Count('id'), d=Count('id', filter=Q(status=CareTask.DONE))).order_by('-n')]
    for k in kinds:
        k['rate'] = pct(k['done'], k['total'])
    who = defaultdict(lambda: {'total': 0, 'done': 0})
    for t in ts.select_related('assigned_to', 'completed_by'):
        k = user_name(t.completed_by or t.assigned_to)
        who[k]['total'] += 1
        who[k]['done'] += t.status == CareTask.DONE
    people = sorted([{'staff': k, **v, 'rate': pct(v['done'], v['total'])} for k, v in who.items()], key=lambda r: -r['total'])
    plans = TreatmentPlan.objects.filter(created_at__date__range=(d_from, d_to))
    st_lbl = dict(TreatmentPlan.STATUS)
    plan_rows = [{'status': st_lbl.get(r['status'], r['status']), 'count': r['n']} for r in plans.values('status').annotate(n=Count('id'))]
    return {
        'title': 'Báo cáo chăm sóc sau điều trị & liệu trình', 'period': [d_from, d_to],
        'kpis': [{'label': 'Việc chăm sóc', 'value': total, 'type': INT},
                 {'label': 'Tỷ lệ hoàn thành', 'value': pct(done, total), 'type': PCT, 'tone': 'green'},
                 {'label': 'Quá hạn chưa làm', 'value': overdue, 'type': INT, 'tone': 'red' if overdue else ''},
                 {'label': 'Liệu trình mới', 'value': plans.count(), 'type': INT}],
        'charts': [{'id': 'kinds', 'type': 'bar', 'title': 'Việc chăm sóc theo loại', 'x': [k['kind'] for k in kinds],
                    'series': [{'name': 'Tổng', 'values': [k['total'] for k in kinds]}, {'name': 'Đã xong', 'values': [k['done'] for k in kinds]}], 'unit': 'int'}],
        'tables': [
            {'id': 'kinds', 'title': 'Hiệu quả theo loại việc', 'columns': [col('kind', 'Loại việc'), col('total', 'Tổng', INT), col('done', 'Đã xong', INT), col('rate', 'Hoàn thành', PCT)], 'rows': kinds},
            {'id': 'people', 'title': 'Theo nhân viên', 'columns': [col('staff', 'Nhân viên'), col('total', 'Tổng', INT), col('done', 'Đã xong', INT), col('rate', 'Hoàn thành', PCT)], 'rows': people},
            {'id': 'plans', 'title': 'Liệu trình theo trạng thái', 'columns': [col('status', 'Trạng thái'), col('count', 'Số liệu trình', INT)], 'rows': plan_rows},
        ],
    }


REPORTS = {'revenue': revenue, 'visits': visits, 'receivables': receivables, 'inventory': inventory, 'care': care}


# --------------------------------------------------------------------------- xuất Excel
def to_xlsx(rep, clinic='PHÒNG KHÁM DA LIỄU AkinaClinic'):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = 'Tổng quan'
    head_fill = PatternFill('solid', fgColor='0D7A8A')
    thin = Side(style='thin', color='D6DEE6')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    fmt = {VND: '#,##0" ₫"', INT: '#,##0', PCT: '0.0"%"', 'min': '0" phút"'}

    def write_table(sheet, r0, t):
        sheet.cell(r0, 1, t['title']).font = Font(bold=True, size=12, color='10253A')
        r = r0 + 1
        for c, cdef in enumerate(t['columns'], 1):
            cell = sheet.cell(r, c, cdef['label'])
            cell.font, cell.fill, cell.border = Font(bold=True, color='FFFFFF'), head_fill, border
            cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        for row in t['rows']:
            r += 1
            for c, cdef in enumerate(t['columns'], 1):
                v = row.get(cdef['key'])
                if cdef['type'] == DATE and isinstance(v, str):
                    try:
                        v = date.fromisoformat(v)
                    except ValueError:
                        pass
                cell = sheet.cell(r, c, v)
                cell.border = border
                if cdef['type'] in fmt:
                    cell.number_format = fmt[cdef['type']]
                    cell.alignment = Alignment(horizontal='right')
                elif cdef['type'] == DATE:
                    cell.number_format = 'DD/MM/YYYY'
        if not t['rows']:
            sheet.cell(r + 1, 1, 'Không có dữ liệu').font = Font(italic=True, color='6B7C8D')
            r += 1
        return r + 2

    d_from, d_to = rep['period']
    ws['A1'], ws['A1'].font = clinic, Font(bold=True, size=11, color='0D7A8A')
    ws['A2'], ws['A2'].font = rep['title'].upper(), Font(bold=True, size=16, color='10253A')
    ws['A3'] = f'Kỳ báo cáo: {d_from:%d/%m/%Y} – {d_to:%d/%m/%Y}   ·   In lúc {timezone.localtime():%H:%M %d/%m/%Y}'
    ws['A3'].font = Font(color='6B7C8D')
    r = 5
    for c, k in enumerate(rep['kpis']):
        ws.cell(r, 1 + c * 2, k['label']).font = Font(color='6B7C8D', size=10)
        v = ws.cell(r + 1, 1 + c * 2, k['value'])
        v.font = Font(bold=True, size=14, color='10253A')
        v.number_format = fmt.get(k['type'], 'General')
        v.alignment = Alignment(horizontal='left')
    r += 4
    for t in rep['tables']:
        r = write_table(ws, r, t)
    widths = defaultdict(int)
    for row in ws.iter_rows(min_row=5):
        for cell in row:
            if cell.value is not None and cell.coordinate not in ws.merged_cells:
                widths[cell.column] = max(widths[cell.column], min(len(str(cell.value)) + 2, 46))
    for c, w in widths.items():
        ws.column_dimensions[get_column_letter(c)].width = max(w, 14)
    ws.sheet_view.showGridLines = False
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
