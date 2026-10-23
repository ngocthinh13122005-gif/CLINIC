from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0015_chat_oa_workspace')]
    operations = [
        migrations.AlterField(
            model_name='message',
            name='message_type',
            field=models.CharField(
                choices=[('text', 'Văn bản'), ('image', 'Hình ảnh'), ('file', 'Tệp'), ('system', 'Hệ thống'), ('csat', 'Mời đánh giá')],
                default='text', max_length=10, verbose_name='Loại tin'),
        ),
    ]
