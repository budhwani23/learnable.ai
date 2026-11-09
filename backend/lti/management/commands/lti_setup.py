"""
python manage.py lti_setup
    Creates the tool's RSA signing key (once) and prints the URLs to give an LMS.

python manage.py lti_setup --register --issuer ... --client-id ... --auth-login-url ...
    --auth-token-url ... --key-set-url ... --deployment-id ...
    Registers an LMS platform (same as adding an "LTI tool" row in Django admin).
"""
import json

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.core.management.base import BaseCommand
from pylti1p3.contrib.django.lti1p3_tool_config.models import LtiTool, LtiToolKey

KEY_NAME = "learnable-default"


def ensure_key() -> LtiToolKey:
    key = LtiToolKey.objects.filter(name=KEY_NAME).first()
    if key:
        return key
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption()).decode()
    pub_pem = private.public_key().public_bytes(serialization.Encoding.PEM,
                                                serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    return LtiToolKey.objects.create(name=KEY_NAME, private_key=priv_pem, public_key=pub_pem)


class Command(BaseCommand):
    help = "Create the LTI signing key and optionally register an LMS platform."

    def add_arguments(self, parser):
        parser.add_argument("--base-url", default="http://localhost:8000",
                            help="Public HTTPS base URL of this backend (for the printed config).")
        parser.add_argument("--register", action="store_true")
        parser.add_argument("--title", default="LMS")
        parser.add_argument("--issuer")
        parser.add_argument("--client-id")
        parser.add_argument("--auth-login-url")
        parser.add_argument("--auth-token-url")
        parser.add_argument("--key-set-url")
        parser.add_argument("--deployment-id", action="append", default=[])

    def handle(self, *args, **o):
        key = ensure_key()
        if o["register"]:
            missing = [k for k in ("issuer", "client_id", "auth_login_url", "auth_token_url", "key_set_url")
                       if not o.get(k)]
            if missing or not o["deployment_id"]:
                self.stderr.write(f"Missing: {', '.join(missing + ([] if o['deployment_id'] else ['deployment_id']))}")
                return
            tool, created = LtiTool.objects.update_or_create(
                issuer=o["issuer"], client_id=o["client_id"],
                defaults={"title": o["title"], "auth_login_url": o["auth_login_url"],
                          "auth_token_url": o["auth_token_url"], "key_set_url": o["key_set_url"],
                          "deployment_ids": json.dumps(o["deployment_id"]), "tool_key": key,
                          "is_active": True},
            )
            self.stdout.write(f"{'Registered' if created else 'Updated'} platform: {tool.title} ({tool.issuer})")

        base = o["base_url"].rstrip("/")
        self.stdout.write("\nGive these to the LMS (Moodle: Site admin > Plugins > External tool > Manage tools):")
        for label, path in [("Tool URL / Launch + Redirect URI", "/lti/launch/"),
                            ("Initiate login URL", "/lti/login/"),
                            ("Public keyset URL", "/lti/jwks/"),
                            ("Deep linking (Content-Item) URL", "/lti/launch/")]:
            self.stdout.write(f"  {label:34} {base}{path}")
        self.stdout.write("  Services: enable Deep Linking + 'IMS LTI Assignment and Grade Services'\n")
