# api.py
from ninja import NinjaAPI
from learning.api import router as learning_router
from content.api import router as content_router
from users.api import router as users_router  # NEW: import users router
from explainer.api import router as explainer_router
from library.api import router as library_router
from lti.api import router as lti_router
api = NinjaAPI(title="Learnable AI")

api.add_router("/learning", learning_router, tags=["Learning"])
api.add_router("/content", content_router, tags=["Content"])
api.add_router("/users", users_router, tags=["Users"])  # NEW: mount users routes
api.add_router("/explainer", explainer_router, tags=["Explainer Video"])
api.add_router("/library", library_router, tags=["Library"])
api.add_router("/lti", lti_router, tags=["LMS (LTI 1.3)"])
