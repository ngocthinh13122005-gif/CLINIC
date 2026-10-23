from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views, views_v2, views_v3, views_v4

router = DefaultRouter()
router.register('patients', views.PatientViewSet, basename='clinic-patient')
router.register('visits', views.VisitViewSet, basename='clinic-visit')
router.register('records', views.MedicalRecordViewSet, basename='clinic-record')
router.register('icd10', views.Icd10ViewSet, basename='clinic-icd10')
router.register('plans', views.TreatmentPlanViewSet, basename='clinic-plan')
router.register('images', views.PatientImageViewSet, basename='clinic-image')
router.register('medicines', views_v2.MedicineViewSet, basename='clinic-medicine')
router.register('prescriptions', views_v2.PrescriptionViewSet, basename='clinic-rx')
router.register('invoices', views_v2.InvoiceViewSet, basename='clinic-invoice')

router.register('suppliers', views_v3.SupplierViewSet, basename='clinic-supplier')
router.register('lots', views_v3.LotViewSet, basename='clinic-lot')
router.register('purchase-orders', views_v3.PurchaseOrderViewSet, basename='clinic-po')
router.register('stock-counts', views_v3.StockCountViewSet, basename='clinic-count')
router.register('rooms', views_v3.RoomViewSet, basename='clinic-room')
router.register('care-tasks', views_v3.CareTaskViewSet, basename='clinic-care')
router.register('consents', views_v3.ConsentViewSet, basename='clinic-consent')

router.register('data-requests', views_v4.DataRequestViewSet, basename='clinic-datareq')
router.register('incidents', views_v4.IncidentViewSet, basename='clinic-incident')

urlpatterns = [
    path('compliance/notice/', views_v4.notice),
    path('compliance/overview/', views_v4.overview),
    path('compliance/retention/', views_v4.retention),
    path('compliance/backups/', views_v4.backups),
    path('compliance/backups/<int:pk>/verify/', views_v4.backup_verify),
    path('compliance/patient-export/<int:pk>/', views_v4.patient_export),
    path('compliance/records/<int:pk>/flags/', views_v4.record_flags),
    path('data-consents/', views_v4.DataConsentViewSet.as_view({'get': 'list', 'post': 'create'})),
    path('data-consents/<int:pk>/withdraw/', views_v4.DataConsentViewSet.as_view({'post': 'withdraw'})),
    path('data-requests/<int:pk>/resolve/', views_v4.DataRequestViewSet.as_view({'post': 'resolve'})),
    path('einvoice-export/', views_v4.einvoice_export),
    path('stock-card/', views_v3.stock_card, name='clinic-stock-card'),
    path('inventory/overview/', views_v3.inventory_overview, name='clinic-inventory-overview'),
    path('audit/', views_v3.audit_log, name='clinic-audit'),
    path('reports/<str:name>/', views_v3.report, name='clinic-report'),
    path('meta/', views.meta, name='clinic-meta'),
    path('dashboard/', views.dashboard, name='clinic-dashboard'),
    path('', include(router.urls)),
]
