"""Danh mục dùng chung cho hồ sơ bệnh án da liễu (vùng da, loại tổn thương, ...)."""

# (mã vùng, nhãn, nhóm hiển thị)
REGIONS = [
    ('scalp', 'Da đầu', 'head'),
    ('forehead', 'Trán', 'face'),
    ('left_temple', 'Thái dương trái', 'face'),
    ('right_temple', 'Thái dương phải', 'face'),
    ('left_eye', 'Quanh mắt trái', 'face'),
    ('right_eye', 'Quanh mắt phải', 'face'),
    ('nose', 'Mũi', 'face'),
    ('left_cheek', 'Má trái', 'face'),
    ('right_cheek', 'Má phải', 'face'),
    ('perioral', 'Quanh miệng', 'face'),
    ('chin', 'Cằm', 'face'),
    ('left_ear', 'Tai trái', 'head'),
    ('right_ear', 'Tai phải', 'head'),
    ('neck', 'Cổ', 'body'),
    ('chest', 'Ngực', 'body'),
    ('abdomen', 'Bụng', 'body'),
    ('upper_back', 'Lưng trên', 'back'),
    ('lower_back', 'Lưng dưới', 'back'),
    ('left_arm', 'Cánh tay trái', 'body'),
    ('right_arm', 'Cánh tay phải', 'body'),
    ('left_hand', 'Bàn tay trái', 'body'),
    ('right_hand', 'Bàn tay phải', 'body'),
    ('groin', 'Vùng bẹn', 'body'),
    ('left_leg', 'Chân trái', 'body'),
    ('right_leg', 'Chân phải', 'body'),
    ('left_foot', 'Bàn chân trái', 'body'),
    ('right_foot', 'Bàn chân phải', 'body'),
    ('nails', 'Móng', 'body'),
]
REGION_CHOICES = [(k, v) for k, v, _ in REGIONS]

LESION_TYPES = [
    ('macule', 'Dát / mảng đổi màu'),
    ('papule', 'Sẩn'),
    ('pustule', 'Mụn mủ'),
    ('nodule', 'Nốt / nang'),
    ('plaque', 'Mảng'),
    ('vesicle', 'Mụn nước / bọng nước'),
    ('scale', 'Vảy da'),
    ('erosion', 'Trợt / loét'),
    ('comedone', 'Nhân mụn'),
    ('scar', 'Sẹo'),
    ('telangiectasia', 'Giãn mao mạch'),
    ('pigment', 'Tăng / giảm sắc tố'),
    ('other', 'Khác'),
]
LESION_CHOICES = LESION_TYPES

FITZPATRICK = [
    ('I', 'Loại I – rất trắng, luôn cháy nắng'),
    ('II', 'Loại II – trắng, dễ cháy nắng'),
    ('III', 'Loại III – trắng ngà, thỉnh thoảng cháy nắng'),
    ('IV', 'Loại IV – nâu nhạt, hiếm khi cháy nắng'),
    ('V', 'Loại V – nâu, rất hiếm khi cháy nắng'),
    ('VI', 'Loại VI – nâu đậm / đen'),
]
