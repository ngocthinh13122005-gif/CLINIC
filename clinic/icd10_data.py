"""Danh mục ICD-10 thường gặp trong da liễu (rút gọn, quản lý có thể bổ sung qua Django Admin)."""
ICD10 = [
    ('Mụn trứng cá & rối loạn nang lông', [
        ('L70.0', 'Mụn trứng cá thông thường'), ('L70.1', 'Mụn trứng cá dạng cụm'), ('L70.8', 'Mụn trứng cá khác'),
        ('L70.9', 'Mụn trứng cá, không đặc hiệu'), ('L71.0', 'Viêm quanh miệng'), ('L71.8', 'Trứng cá đỏ (rosacea) khác'),
        ('L71.9', 'Trứng cá đỏ, không đặc hiệu'), ('L73.2', 'Viêm mủ tuyến mồ hôi (hidradenitis suppurativa)'),
        ('L73.9', 'Rối loạn nang lông, không đặc hiệu')]),
    ('Viêm da & chàm', [
        ('L20.0', 'Chàm Besnier (prurigo)'), ('L20.8', 'Viêm da cơ địa khác'), ('L20.9', 'Viêm da cơ địa, không đặc hiệu'),
        ('L21.0', 'Viêm da tiết bã – da đầu'), ('L21.9', 'Viêm da tiết bã, không đặc hiệu'),
        ('L23.9', 'Viêm da tiếp xúc dị ứng, không rõ nguyên nhân'), ('L24.9', 'Viêm da tiếp xúc kích ứng, không rõ nguyên nhân'),
        ('L25.9', 'Viêm da tiếp xúc, không đặc hiệu'), ('L30.0', 'Chàm đồng tiền'), ('L30.9', 'Viêm da, không đặc hiệu'),
        ('L27.0', 'Phát ban toàn thân do thuốc'), ('L56.2', 'Viêm da do ánh sáng')]),
    ('Mày đay, ngứa', [
        ('L50.0', 'Mày đay dị ứng'), ('L50.1', 'Mày đay tự phát'), ('L50.9', 'Mày đay, không đặc hiệu'),
        ('L29.8', 'Ngứa khác'), ('L29.9', 'Ngứa, không đặc hiệu'), ('L28.1', 'Sẩn cục ngứa (prurigo nodularis)')]),
    ('Bệnh vảy', [
        ('L40.0', 'Vảy nến thông thường'), ('L40.5', 'Viêm khớp vảy nến'), ('L40.9', 'Vảy nến, không đặc hiệu'),
        ('L41.9', 'Á vảy nến, không đặc hiệu'), ('L43.9', 'Lichen phẳng, không đặc hiệu'), ('L44.0', 'Lichen đỏ'),
        ('L85.9', 'Dày sừng/da dày, không đặc hiệu')]),
    ('Rối loạn sắc tố', [
        ('L81.0', 'Tăng sắc tố sau viêm'), ('L81.1', 'Nám (chloasma)'), ('L81.2', 'Tàn nhang'),
        ('L81.4', 'Tăng sắc tố melanin khác'), ('L81.9', 'Rối loạn sắc tố, không đặc hiệu'),
        ('L80', 'Bạch biến'), ('D22.9', 'Nốt ruồi sắc tố, không đặc hiệu'), ('Q82.5', 'Bớt bẩm sinh không tân sinh')]),
    ('Nhiễm trùng da', [
        ('L01.0', 'Chốc'), ('L02.9', 'Áp xe da, nhọt, hậu bối'), ('L03.9', 'Viêm mô tế bào, không đặc hiệu'),
        ('L08.9', 'Nhiễm khuẩn da khác, không đặc hiệu'), ('B00.9', 'Nhiễm Herpes simplex'), ('B02.9', 'Zona (Herpes zoster)'),
        ('B07', 'Mụn cóc do virus'), ('B08.1', 'U mềm lây (molluscum contagiosum)'), ('A63.0', 'Sùi mào gà vùng sinh dục')]),
    ('Nấm & ký sinh trùng', [
        ('B35.0', 'Nấm da đầu và râu'), ('B35.3', 'Nấm bàn chân (tinea pedis)'), ('B35.4', 'Nấm thân'),
        ('B35.6', 'Nấm bẹn (tinea cruris)'), ('B35.1', 'Nấm móng'), ('B36.0', 'Lang ben (pityriasis versicolor)'),
        ('B37.2', 'Nấm Candida da và móng'), ('B86', 'Ghẻ (scabies)')]),
    ('Tóc & móng', [
        ('L63.9', 'Rụng tóc từng mảng, không đặc hiệu'), ('L64.9', 'Rụng tóc androgen, không đặc hiệu'),
        ('L65.9', 'Rụng tóc không sẹo, không đặc hiệu'), ('L60.9', 'Rối loạn móng, không đặc hiệu')]),
    ('Sẹo, lão hóa & tổn thương do ánh sáng', [
        ('L90.5', 'Sẹo và xơ hóa da'), ('L91.0', 'Sẹo lồi / sẹo phì đại'), ('L57.0', 'Dày sừng ánh sáng'),
        ('L57.8', 'Da tổn thương do ánh sáng mạn tính khác'), ('L98.9', 'Rối loạn da và mô dưới da, không đặc hiệu'),
        ('I78.1', 'Nevus mạch máu / giãn mao mạch'), ('L82', 'Dày sừng tiết bã'), ('L72.0', 'Nang thượng bì')]),
    ('Khác', [
        ('L10.9', 'Pemphigus, không đặc hiệu'), ('L12.9', 'Pemphigoid, không đặc hiệu'), ('L93.0', 'Lupus ban đỏ dạng đĩa'),
        ('L94.0', 'Xơ cứng bì khu trú'), ('L66.9', 'Rụng tóc có sẹo, không đặc hiệu'), ('L89.9', 'Loét tì đè, không đặc hiệu'),
        ('R23.8', 'Tổn thương da khác chưa rõ'), ('Z00.0', 'Khám sức khỏe tổng quát')]),
]
