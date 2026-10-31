from django.db import migrations


LEGACY_COLUMNS = {
    'capture_angle': 80,
    'lighting': 100,
    'camera_device': 100,
}


def relax_legacy_patient_image_metadata(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'mysql':
        return

    table = 'clinic_patientimage'
    with connection.cursor() as cursor:
        columns = connection.introspection.get_table_description(cursor, table)
        existing = {column.name: column for column in columns}
        for name, length in LEGACY_COLUMNS.items():
            column = existing.get(name)
            if column and not column.null_ok:
                schema_editor.execute(
                    f'ALTER TABLE {schema_editor.quote_name(table)} '
                    f'MODIFY COLUMN {schema_editor.quote_name(name)} VARCHAR({length}) NULL'
                )


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ('clinic', '0005_v4_compliance'),
    ]

    operations = [
        migrations.RunPython(
            relax_legacy_patient_image_metadata,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
