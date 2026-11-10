# api.py
from ninja import NinjaAPI
from learning.api import router as learning_router
from content.api import router as content_router
from users.api import router as users_router  # NEW: import users router
from explainer.api import router as explainer_router
from library.api import router as library_router
from lti.api import router as lti_router
from presentations.api import router as presentations_router
from presentations.image_proxy import router as presentations_image_router
from adminpanel.api import router as admin_router
from users.security import AccountBlocked

api = NinjaAPI(title="Learnable AI")


@api.exception_handler(AccountBlocked)
def account_blocked(request, exc: AccountBlocked):
    """Waitlisted, banned, deactivated or non-admin: 403 with a machine-readable code."""
    return api.create_response(request, {"detail": exc.detail, "code": exc.code}, status=403)


api.add_router("/learning", learning_router, tags=["Learning"])
api.add_router("/content", content_router, tags=["Content"])
api.add_router("/users", users_router, tags=["Users"])  # NEW: mount users routes
api.add_router("/explainer", explainer_router, tags=["Explainer Video"])
api.add_router("/library", library_router, tags=["Library"])
api.add_router("/lti", lti_router, tags=["LMS (LTI 1.3)"])
api.add_router("/presentations", presentations_router, tags=["Presentations"])
# Called by the Presenton container (Bearer PRESENTON_IMAGE_PROXY_KEY), not by browsers.
api.add_router("/admin", admin_router, tags=["Admin"])
api.add_router("/presentations/image-proxy", presentations_image_router, tags=["Presentations"])
