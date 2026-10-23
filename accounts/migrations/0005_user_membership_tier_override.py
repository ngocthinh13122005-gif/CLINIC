from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0004_user_date_of_birth_passwordresetcode')]
    operations = [
        migrations.AddField(
            model_name='user',
            name='membership_tier_override',
            field=models.CharField(blank=True, choices=[('', 'Tự động'), ('Bronze', 'Bronze'), ('Silver', 'Silver'), ('Gold', 'Gold'), ('Platinum', 'Platinum')], max_length=12, verbose_name='Hạng thành viên chỉ định'),
        ),
    ]
