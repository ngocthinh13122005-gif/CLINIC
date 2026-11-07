from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ('clinic', '0013_crmlead'),
    ]

    operations = [
        migrations.CreateModel(
            name='StockLocation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=20, unique=True, verbose_name='Mã kho')),
                ('name', models.CharField(max_length=80, verbose_name='Tên kho')),
                ('note', models.CharField(blank=True, max_length=255, verbose_name='Ghi chú')),
                ('is_default', models.BooleanField(default=False, verbose_name='Kho mặc định')),
                ('is_active', models.BooleanField(default=True, verbose_name='Đang dùng')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={'ordering': ['-is_default', 'name'], 'verbose_name': 'Kho / vị trí', 'verbose_name_plural': 'Kho / vị trí'},
        ),
        migrations.AddField(model_name='stocklot', name='location',
                            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                                    related_name='lots', to='clinic.stocklocation', verbose_name='Kho / vị trí')),
        migrations.AddField(model_name='purchaseorder', name='location',
                            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                                    related_name='+', to='clinic.stocklocation', verbose_name='Nhập về kho')),
        migrations.AddField(model_name='purchaseorder', name='supplier_ref',
                            field=models.CharField(blank=True, max_length=40, verbose_name='Số chứng từ NCC')),
        migrations.AddField(model_name='stockcount', name='name',
                            field=models.CharField(blank=True, max_length=120, verbose_name='Tên đợt kiểm')),
        migrations.AddField(model_name='stockcount', name='location',
                            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                                    related_name='+', to='clinic.stocklocation', verbose_name='Kho kiểm')),
        migrations.CreateModel(
            name='StockTransfer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(blank=True, max_length=20, unique=True, verbose_name='Số phiếu chuyển')),
                ('status', models.CharField(choices=[('draft', 'Nháp'), ('pending', 'Chờ nhận'), ('partial', 'Nhận một phần'), ('received', 'Đã nhận'), ('cancelled', 'Đã hủy')], db_index=True, default='draft', max_length=10)),
                ('note', models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('received_at', models.DateTimeField(blank=True, null=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='accounts.user')),
                ('from_location', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='clinic.stocklocation')),
                ('to_location', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='clinic.stocklocation')),
            ],
            options={'ordering': ['-created_at', '-id'], 'verbose_name': 'Phiếu chuyển kho', 'verbose_name_plural': 'Phiếu chuyển kho'},
        ),
        migrations.CreateModel(
            name='StockTransferLine',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('quantity', models.PositiveIntegerField(verbose_name='Số lượng chuyển')),
                ('received_qty', models.PositiveIntegerField(default=0, verbose_name='Đã nhận')),
                ('medicine', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='clinic.medicine')),
                ('transfer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='lines', to='clinic.stocktransfer')),
            ],
            options={'ordering': ['id']},
        ),
        migrations.AlterField(
            model_name='stockmovement', name='kind',
            field=models.CharField(choices=[('in', 'Nhập kho'), ('out', 'Xuất bán'), ('adjust', 'Kiểm kê / điều chỉnh'), ('scrap', 'Hủy / hết hạn'), ('transfer', 'Chuyển kho')], max_length=8),
        ),
    ]
