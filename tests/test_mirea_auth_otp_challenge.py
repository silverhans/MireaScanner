import unittest


from bot.services.mirea_auth import MireaAuth  # noqa: E402


class TestOtpChallengeExtraction(unittest.TestCase):
    def test_spa_otp_login_action(self):
        html = '{"otpLogin":true,"loginAction":"https://sso.mirea.ru/auth/realms/x/login-actions/authenticate"}'
        auth = MireaAuth.__new__(MireaAuth)  # avoid creating http clients
        challenge = auth._extract_otp_challenge(html, base_url="https://sso.mirea.ru/")
        self.assertIsNotNone(challenge)
        self.assertEqual(challenge.kind, "otp")
        self.assertEqual(challenge.field_name, "otp")
        self.assertIn("https://sso.mirea.ru/", challenge.action_url)

    def test_classic_form_with_hidden_fields(self):
        html = """
        <html>
          <body>
            <form id="kc-otp-login-form" action="/login-actions/authenticate">
              <input type="hidden" name="session_code" value="abc">
              <input type="hidden" name="execution" value="def">
              <input type="text" name="otp" autocomplete="one-time-code">
            </form>
          </body>
        </html>
        """
        auth = MireaAuth.__new__(MireaAuth)
        challenge = auth._extract_otp_challenge(html, base_url="https://sso.mirea.ru/realms/x/")
        self.assertIsNotNone(challenge)
        self.assertEqual(challenge.kind, "otp")
        self.assertEqual(challenge.field_name, "otp")
        self.assertTrue(challenge.action_url.startswith("https://sso.mirea.ru/"))
        self.assertEqual(challenge.hidden_fields.get("session_code"), "abc")
        self.assertEqual(challenge.hidden_fields.get("execution"), "def")

    def test_heuristic_one_time_code_form(self):
        html = """
        <html>
          <body>
            <form action="https://sso.mirea.ru/login-actions/authenticate">
              <input type="hidden" name="foo" value="bar">
              <input type="tel" name="code" autocomplete="one-time-code" inputmode="numeric">
            </form>
          </body>
        </html>
        """
        auth = MireaAuth.__new__(MireaAuth)
        challenge = auth._extract_otp_challenge(html, base_url="https://sso.mirea.ru/")
        self.assertIsNotNone(challenge)
        self.assertEqual(challenge.kind, "otp")
        self.assertEqual(challenge.field_name, "code")
        self.assertEqual(challenge.hidden_fields.get("foo"), "bar")


if __name__ == "__main__":
    unittest.main()

