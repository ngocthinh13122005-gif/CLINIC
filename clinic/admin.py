from django.contrib import admin

from .models import Icd10Code, MedicalRecord, Patient, TreatmentPlan, Visit


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = ('code', 'full_name', 'phone', 'gender', 'is_active', 'created_at')
    search_fields = ('code', 'full_name', 'phone')


@admin.register(Visit)
class VisitAdmin(admin.ModelAdmin):
    list_display = ('id', 'patient', 'status', 'doctor', 'check_in_at')
    list_filter = ('status', 'visit_type')


@admin.register(MedicalRecord)
class MedicalRecordAdmin(admin.ModelAdmin):
    list_display = ('code', 'patient', 'diagnosis_code', 'status', 'created_at')
    readonly_fields = ('signature_hash',)


@admin.register(TreatmentPlan)
class TreatmentPlanAdmin(admin.ModelAdmin):
    list_display = ('title', 'patient', 'status', 'total_sessions')


admin.site.register(Icd10Code)
