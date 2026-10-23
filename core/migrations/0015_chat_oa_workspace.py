from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0014_staff_operations_rostershift')]

    operations = [
        migrations.AddField(model_name='message', name='attachment', field=models.FileField(blank=True, null=True, upload_to='chat/%Y/%m/%d/', verbose_name='Tệp đính kèm')),
        migrations.AddField(model_name='message', name='attachment_mime', field=models.CharField(blank=True, max_length=120, verbose_name='MIME type')),
        migrations.AddField(model_name='message', name='attachment_name', field=models.CharField(blank=True, max_length=255, verbose_name='Tên tệp')),
        migrations.AddField(model_name='message', name='attachment_size', field=models.PositiveBigIntegerField(default=0, verbose_name='Dung lượng')),
        migrations.AddField(model_name='message', name='message_type', field=models.CharField(choices=[('text','Văn bản'),('image','Hình ảnh'),('file','Tệp'),('system','Hệ thống')], default='text', max_length=10, verbose_name='Loại tin')),
        migrations.AlterField(model_name='message', name='text', field=models.TextField(blank=True, max_length=2000, verbose_name='Nội dung')),
    ]
