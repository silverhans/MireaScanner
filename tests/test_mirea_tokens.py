import unittest


from bot.services.mirea_tokens import get_authorization_header  # noqa: E402


class TestGetAuthorizationHeader(unittest.TestCase):
    def test_bearer_token(self):
        cookies = {"access_token": "abc123", "token_type": "Bearer"}
        self.assertEqual(get_authorization_header(cookies), "Bearer abc123")

    def test_default_token_type(self):
        cookies = {"access_token": "xyz"}
        self.assertEqual(get_authorization_header(cookies), "Bearer xyz")

    def test_custom_token_type(self):
        cookies = {"access_token": "tok", "token_type": "MAC"}
        self.assertEqual(get_authorization_header(cookies), "MAC tok")

    def test_no_access_token(self):
        self.assertIsNone(get_authorization_header({"refresh_token": "r"}))

    def test_empty_access_token(self):
        self.assertIsNone(get_authorization_header({"access_token": ""}))

    def test_whitespace_access_token(self):
        self.assertIsNone(get_authorization_header({"access_token": "   "}))

    def test_none_cookies(self):
        self.assertIsNone(get_authorization_header(None))

    def test_empty_dict(self):
        self.assertIsNone(get_authorization_header({}))

    def test_empty_token_type_defaults_to_bearer(self):
        cookies = {"access_token": "tok", "token_type": ""}
        self.assertEqual(get_authorization_header(cookies), "Bearer tok")


if __name__ == "__main__":
    unittest.main()
