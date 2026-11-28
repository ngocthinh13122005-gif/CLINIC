from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIRequestFactory

from core.models import Conversation
from .messenger import _customer_for_psid, _FacebookImageRedirects, sync_messenger_avatar
from .serializers import ConversationSerializer

User = get_user_model()


@override_settings(META_PAGE_ID='page-test', FIREBASE_ENABLED=False,
                   CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class MessengerAvatarTests(TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=directory.name))
        cache.clear()
        self.user = User.objects.create_user(username='fb_1234', role='customer', first_name='Thịnh', last_name='Ngọc')
        buffer = BytesIO()
        Image.new('RGB', (2, 2), (0, 100, 150)).save(buffer, format='PNG')
        self.image = buffer.getvalue()

    def response(self, content=None, length=None):
        response = MagicMock()
        response.__enter__.return_value = response
        response.headers = {} if length is None else {'Content-Length': str(length)}
        response.read.return_value = self.image if content is None else content
        return response

    @patch('api.messenger.build_opener')
    @patch('api.messenger._profile', return_value={'profile_pic': 'https://platform-lookaside.fbsbx.com/photo'})
    def test_avatar_is_saved_locally_and_inbox_serializer_returns_it(self, profile, opener):
        opener.return_value.open.return_value = self.response()
        self.assertTrue(sync_messenger_avatar(self.user.pk, '1234'))
        self.user.refresh_from_db()
        self.assertTrue(self.user.avatar.name.startswith('avatars/facebook/'))
        with self.user.avatar.open('rb') as photo:
            self.assertEqual(photo.read(), self.image)
        conversation = Conversation.objects.create(customer=self.user, subject='Facebook chat', channel='facebook')
        request = APIRequestFactory().get('/', HTTP_HOST='testserver')
        request.user = self.user
        data = ConversationSerializer(conversation, context={'request': request}).data
        self.assertIn('/media/avatars/facebook/', data['customer_avatar_url'])
        self.assertNotIn('fbsbx.com', data['customer_avatar_url'])

    @patch('api.messenger._profile')
    def test_existing_uploaded_avatar_is_preserved(self, profile):
        self.user.avatar.save('manual.png', ContentFile(self.image), save=True)
        previous = self.user.avatar.name
        self.assertFalse(sync_messenger_avatar(self.user.pk, '1234'))
        self.user.refresh_from_db()
        self.assertEqual(self.user.avatar.name, previous)
        profile.assert_not_called()

    @patch('api.messenger.build_opener')
    @patch('api.messenger._profile', return_value={})
    def test_missing_profile_photo_keeps_initials_fallback(self, profile, opener):
        self.assertFalse(sync_messenger_avatar(self.user.pk, '1234'))
        self.user.refresh_from_db()
        self.assertFalse(self.user.avatar)
        self.assertEqual(self.user.get_full_name(), 'Thịnh Ngọc')
        opener.assert_not_called()

    @patch('api.messenger.build_opener')
    @patch('api.messenger._profile', return_value={'profile_pic': 'https://127.0.0.1/private'})
    def test_non_facebook_image_source_is_not_downloaded(self, profile, opener):
        self.assertFalse(sync_messenger_avatar(self.user.pk, '1234'))
        opener.assert_not_called()

    def test_redirect_to_non_facebook_host_is_rejected(self):
        with self.assertRaises(ValueError):
            _FacebookImageRedirects().redirect_request(None, None, 302, '', {}, 'https://example.com/photo')

    @patch('api.messenger.build_opener')
    @patch('api.messenger._profile', return_value={'profile_pic': 'https://scontent.xx.fbcdn.net/photo'})
    def test_non_image_response_is_not_saved(self, profile, opener):
        opener.return_value.open.return_value = self.response(b'<html>Error</html>')
        self.assertFalse(sync_messenger_avatar(self.user.pk, '1234'))
        self.user.refresh_from_db()
        self.assertFalse(self.user.avatar)

    @patch('api.messenger.build_opener')
    @patch('api.messenger._profile', return_value={'profile_pic': 'https://scontent.xx.fbcdn.net/photo'})
    def test_large_response_is_not_downloaded(self, profile, opener):
        response = self.response(length=3 * 1024 * 1024)
        opener.return_value.open.return_value = response
        self.assertFalse(sync_messenger_avatar(self.user.pk, '1234'))
        response.read.assert_not_called()

    @patch('api.tasks.sync_messenger_avatar_task.delay')
    @patch('api.messenger._profile')
    def test_existing_customer_is_synced_after_commit_and_throttled(self, profile, delay):
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(_customer_for_psid('1234').pk, self.user.pk)
            _customer_for_psid('1234')
            delay.assert_not_called()
        delay.assert_called_once_with(self.user.pk, '1234')
        profile.assert_not_called()

    @patch('api.messenger._profile')
    def test_other_accounts_cannot_receive_this_messenger_avatar(self, profile):
        self.assertFalse(sync_messenger_avatar(self.user.pk, 'different-psid'))
        profile.assert_not_called()
