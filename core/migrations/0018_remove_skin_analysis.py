"""Gỡ chức năng phân tích da (AI).

Viết theo kiểu "an toàn": chỉ xóa cột/bảng nếu còn tồn tại, nên chạy được trên:
- CSDL mới (đang còn bảng phân tích da → xóa),
- CSDL đã nâng cấp từ bản trước đã xóa sẵn (không còn gì để xóa → chỉ cập nhật trạng thái).
"""
from django.db import migrations


def drop_if_present(apps, schema_editor):
    conn = schema_editor.connection
    tables = set(conn.introspection.table_names())
    Conversation = apps.get_model('core', 'Conversation')
    Service = apps.get_model('core', 'Service')
    SkinAnalysis = apps.get_model('core', 'SkinAnalysis')
    SkinTag = apps.get_model('core', 'SkinTag')

    conv_table = Conversation._meta.db_table
    if conv_table in tables:
        with conn.cursor() as cur:
            cols = {c.name for c in conn.introspection.get_table_description(cur, conv_table)}
        if 'skin_analysis_id' in cols:
            schema_editor.remove_field(Conversation, Conversation._meta.get_field('skin_analysis'))

    tags_field = Service._meta.get_field('skin_tags')
    if tags_field.remote_field.through._meta.db_table in tables:
        schema_editor.remove_field(Service, tags_field)

    for model in (SkinAnalysis, SkinTag):
        if model._meta.db_table in tables:
            schema_editor.delete_model(model)


class Migration(migrations.Migration):
    dependencies = [('core', '0017_booking_appointment_type_booking_patient_and_more')]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[migrations.RunPython(drop_if_present, migrations.RunPython.noop)],
            state_operations=[
                migrations.RemoveField(model_name='conversation', name='skin_analysis'),
                migrations.RemoveField(model_name='service', name='skin_tags'),
                migrations.RemoveField(model_name='skinanalysis', name='recommended_services'),
                migrations.DeleteModel(name='SkinAnalysis'),
                migrations.DeleteModel(name='SkinTag'),
            ],
        ),
    ]
