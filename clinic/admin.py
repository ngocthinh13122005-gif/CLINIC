from django.contrib import admin

from .models import Icd10Code, MedicalRecord, PackageTemplate, Patient, TreatmentPlan, Visit


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = ('code', 'full_name', 'phone', 'user', 'gender', 'is_active', 'created_at')
    list_select_related = ('user',)
    search_fields = ('code', 'full_name', 'phone', 'user__username', 'user__email')


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
    list_display = ('code', 'title', 'patient', 'status', 'total_sessions', 'expires_at')


@admin.register(PackageTemplate)
class PackageTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'service', 'price', 'total_sessions', 'validity_months', 'is_active')
    list_filter = ('is_active', 'is_custom')
    search_fields = ('name', 'description')


admin.site.register(Icd10Code)
