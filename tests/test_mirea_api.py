import unittest


from bot.services.mirea_api import MireaAPI  # noqa: E402
from bot.api.common import normalize_friend_telegram_ids  # noqa: E402


class TestExtractTokenFromQR(unittest.TestCase):
    """Test QR token extraction logic (static method, no HTTP)."""

    VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

    def test_bare_uuid(self):
        token, err = MireaAPI.extract_token_from_qr(self.VALID_UUID)
        self.assertEqual(token, self.VALID_UUID)
        self.assertIsNone(err)

    def test_bare_uuid_uppercase(self):
        token, err = MireaAPI.extract_token_from_qr(self.VALID_UUID.upper())
        self.assertEqual(token, self.VALID_UUID.upper())
        self.assertIsNone(err)

    def test_url_attendance_app(self):
        url = f"https://attendance-app.mirea.ru/selfapprove?token={self.VALID_UUID}"
        token, err = MireaAPI.extract_token_from_qr(url)
        self.assertEqual(token, self.VALID_UUID)
        self.assertIsNone(err)

    def test_url_pulse(self):
        url = f"https://pulse.mirea.ru/selfapprove?token={self.VALID_UUID}"
        token, err = MireaAPI.extract_token_from_qr(url)
        self.assertEqual(token, self.VALID_UUID)
        self.assertIsNone(err)

    def test_url_att_domain(self):
        url = f"https://att.mirea.ru/selfapprove?token={self.VALID_UUID}"
        token, err = MireaAPI.extract_token_from_qr(url)
        self.assertEqual(token, self.VALID_UUID)
        self.assertIsNone(err)

    def test_url_without_scheme(self):
        url = f"attendance-app.mirea.ru/selfapprove?token={self.VALID_UUID}"
        token, err = MireaAPI.extract_token_from_qr(url)
        self.assertEqual(token, self.VALID_UUID)
        self.assertIsNone(err)

    def test_url_extra_params(self):
        url = f"https://attendance-app.mirea.ru/selfapprove?token={self.VALID_UUID}&foo=bar"
        token, err = MireaAPI.extract_token_from_qr(url)
        self.assertEqual(token, self.VALID_UUID)
        self.assertIsNone(err)

    def test_invalid_domain(self):
        url = f"https://evil.com/selfapprove?token={self.VALID_UUID}"
        token, err = MireaAPI.extract_token_from_qr(url)
        self.assertIsNone(token)
        self.assertIn("Неверный QR", err)

    def test_missing_token_param(self):
        url = "https://attendance-app.mirea.ru/selfapprove?foo=bar"
        token, err = MireaAPI.extract_token_from_qr(url)
        self.assertIsNone(token)
        self.assertIn("не содержит токен", err)

    def test_empty_input(self):
        token, err = MireaAPI.extract_token_from_qr("")
        self.assertIsNone(token)
        self.assertIsNotNone(err)

    def test_garbage_input(self):
        token, err = MireaAPI.extract_token_from_qr("random garbage text")
        self.assertIsNone(token)
        self.assertIsNotNone(err)

    def test_whitespace_trimmed(self):
        token, err = MireaAPI.extract_token_from_qr(f"  {self.VALID_UUID}  ")
        self.assertEqual(token, self.VALID_UUID)
        self.assertIsNone(err)


class TestNormalizeFriendTelegramIds(unittest.TestCase):
    """Test friend ID normalization and validation."""

    def test_valid_ints(self):
        ids, err = normalize_friend_telegram_ids([111, 222, 333])
        self.assertIsNone(err)
        self.assertEqual(ids, [111, 222, 333])

    def test_mixed_int_and_string(self):
        ids, err = normalize_friend_telegram_ids([111, "222"])
        self.assertIsNone(err)
        self.assertEqual(ids, [111, 222])

    def test_exceeds_max_items(self):
        ids, err = normalize_friend_telegram_ids(list(range(1, 25)), max_items=20)
        self.assertIsNotNone(err)
        self.assertIn("не более", err)

    def test_boolean_rejected(self):
        ids, err = normalize_friend_telegram_ids([True, 123])
        self.assertIsNotNone(err)

    def test_negative_rejected(self):
        ids, err = normalize_friend_telegram_ids([-5])
        self.assertIsNotNone(err)

    def test_zero_rejected(self):
        ids, err = normalize_friend_telegram_ids([0])
        self.assertIsNotNone(err)

    def test_deduplication(self):
        ids, err = normalize_friend_telegram_ids([100, 200, 100, 200])
        self.assertIsNone(err)
        self.assertEqual(ids, [100, 200])

    def test_none_input(self):
        ids, err = normalize_friend_telegram_ids(None)
        self.assertIsNone(err)
        self.assertEqual(ids, [])

    def test_not_a_list(self):
        ids, err = normalize_friend_telegram_ids("123")
        self.assertIsNotNone(err)

    def test_non_digit_string_rejected(self):
        ids, err = normalize_friend_telegram_ids(["abc"])
        self.assertIsNotNone(err)

    def test_empty_list(self):
        ids, err = normalize_friend_telegram_ids([])
        self.assertIsNone(err)
        self.assertEqual(ids, [])


if __name__ == "__main__":
    unittest.main()
