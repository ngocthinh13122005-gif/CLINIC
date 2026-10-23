from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0003_user_loyalty_points')]
    operations = [
        migrations.AddField(model_name='user', name='date_of_birth', field=models.DateField(blank=True, null=True, verbose_name='Ngày sinh')),
        migrations.CreateModel(
            name='PasswordResetCode',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.EmailField(db_index=True, max_length=254)),
                ('code_hash', models.CharField(max_length=128)),
                ('reset_token', models.CharField(blank=True, db_index=True, max_length=80)),
                ('expires_at', models.DateTimeField()),
                ('verified', models.BooleanField(default=False)),
                ('used', models.BooleanField(default=False)),
                ('attempts', models.PositiveSmallIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
