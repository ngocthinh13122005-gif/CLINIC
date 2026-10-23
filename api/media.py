from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import default_storage


def upload_media(file_obj, *, folder='ohio'):
    """Upload to Cloudinary when configured, otherwise store in Django MEDIA_ROOT.

    This keeps local development zero-config while preserving Cloudinary for production.
    """
    if settings.CLOUDINARY_URL:
        import cloudinary
        import cloudinary.uploader

        cloudinary.config(secure=True)
        result = cloudinary.uploader.upload(file_obj, folder=folder, resource_type='auto')
        return {
            'provider': 'cloudinary',
            'public_id': result.get('public_id'),
            'url': result.get('secure_url') or result.get('url'),
            'resource_type': result.get('resource_type'),
        }

    suffix = Path(getattr(file_obj, 'name', '')).suffix.lower()[:10]
    relative_name = f'{folder}/{uuid4().hex}{suffix}'
    saved_name = default_storage.save(relative_name, file_obj)
    return {
        'provider': 'local',
        'public_id': saved_name,
        'url': settings.MEDIA_URL + saved_name.replace('\\', '/'),
        'resource_type': 'file',
    }


# Backward-compatible name used by existing API view.
def upload_to_cloudinary(file_obj, *, folder='ohio'):
    result = upload_media(file_obj, folder=folder)
    return {'enabled': True, **result}
