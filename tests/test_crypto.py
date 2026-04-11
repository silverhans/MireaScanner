import unittest


from bot.services.crypto import SessionCrypto  # noqa: E402


class TestSessionCrypto(unittest.TestCase):
    def test_roundtrip_encrypt_decrypt(self):
        crypto = SessionCrypto("primary_secret", legacy_bot_token="legacy")
        cookies = {"a": "b", "n": 1, "nested": {"x": True}}
        encrypted = crypto.encrypt_session(cookies)
        decrypted = crypto.decrypt_session(encrypted)
        self.assertEqual(decrypted, cookies)

    def test_rotation_returns_new_ciphertext(self):
        cookies = {"k": "v"}
        # Old deployment used old_secret as primary.
        crypto_old = SessionCrypto("old_secret,new_secret", legacy_bot_token="legacy")
        encrypted_old = crypto_old.encrypt_session(cookies)

        # New deployment uses new_secret as primary and keeps old_secret for decryption.
        crypto_new = SessionCrypto("new_secret,old_secret", legacy_bot_token="legacy")
        decrypted, rotated = crypto_new.decrypt_session_for_db(encrypted_old)
        self.assertEqual(decrypted, cookies)
        self.assertIsNotNone(rotated)
        self.assertEqual(crypto_new.decrypt_session(rotated), cookies)

    def test_tampered_ciphertext_fails(self):
        crypto = SessionCrypto("primary_secret", legacy_bot_token="legacy")
        encrypted = crypto.encrypt_session({"a": "b"})
        # Flip a character at the end (Fernet tokens are base64-url strings).
        tampered = encrypted[:-1] + ("A" if encrypted[-1] != "A" else "B")
        self.assertIsNone(crypto.decrypt_session(tampered))


if __name__ == "__main__":
    unittest.main()

