"""
Generate VAPID keys for Web Push notifications.
Run once, then add the keys to your .env file.

Usage:
    pip install py-vapid
    python scripts/generate_vapid.py
"""

try:
    from py_vapid import Vapid

    vapid = Vapid()
    vapid.generate_keys()

    print("=" * 50)
    print("  VAPID Keys Generated")
    print("=" * 50)
    print()
    print(f"VAPID_PRIVATE_KEY={vapid.private_pem().decode().strip()}")
    print()
    print(f"NEXT_PUBLIC_VAPID_PUBLIC_KEY={vapid.public_key_urlsafe_base64()}")
    print()
    print("Add these to your .env file.")
    print("The public key goes in the frontend (NEXT_PUBLIC_).")
    print("The private key stays server-side only.")

except ImportError:
    print("Install py-vapid first:")
    print("  pip install py-vapid")
    print()
    print("Then run this script again.")
