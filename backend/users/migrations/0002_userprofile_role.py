from django.db import migrations, models


def backfill_roles(apps, schema_editor):
    """
    Existing accounts keep what they could do before roles existed:
    - password accounts (self-registered creators) become teachers
    - Google / LMS accounts (passwordless, mostly students opening shared links) become
      students, unless they have launched from an LMS as an instructor
    """
    UserProfile = apps.get_model("users", "UserProfile")
    User = apps.get_model("auth", "User")
    LtiLaunch = apps.get_model("lti", "LtiLaunch")

    for user in User.objects.all().iterator():
        profile, _ = UserProfile.objects.get_or_create(user=user)
        passwordless = not user.password or user.password.startswith("!")
        if not passwordless or LtiLaunch.objects.filter(user=user, is_instructor=True).exists():
            profile.role = "teacher"
        else:
            profile.role = "student"
        profile.save(update_fields=["role"])


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0001_initial"),
        ("lti", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="role",
            field=models.CharField(
                choices=[("teacher", "Teacher"), ("student", "Student")],
                db_index=True, default="student", max_length=16,
            ),
        ),
        migrations.RunPython(backfill_roles, migrations.RunPython.noop),
    ]
