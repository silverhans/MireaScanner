import unittest


from bot.services.webapp_api import _redact_qr_data_for_log  # noqa: E402


class TestRedactQrDataForLog(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(_redact_qr_data_for_log(""), "")
        self.assertEqual(_redact_qr_data_for_log("   "), "")

    def test_url_token_redaction(self):
        v = _redact_qr_data_for_log("https://attendance-app.mirea.ru/selfapprove?token=SECRET&x=1")
        self.assertEqual(v, "https://attendance-app.mirea.ru/selfapprove?token=<redacted>")

    def test_non_url_token_redaction(self):
        self.assertEqual(_redact_qr_data_for_log("SECRET_TOKEN"), "<redacted_token>")


if __name__ == "__main__":
    unittest.main()

