from fastapi import FastAPI

from .routers import note, provider, model, config, chat, auth, note_style, profile, export_note, share, feedback, billing, admin, admin_cookies, admin_notifications, platform, update_logs, admin_update_logs, note_collection, flashcard


def create_app(lifespan) -> FastAPI:
    app = FastAPI(title="NoteFlow", lifespan=lifespan)
    app.include_router(note.router, prefix="/api")
    app.include_router(provider.router, prefix="/api")
    app.include_router(model.router, prefix="/api")
    app.include_router(config.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(note_style.router, prefix="/api")
    app.include_router(profile.router, prefix="/api")
    app.include_router(export_note.router, prefix="/api")
    app.include_router(share.router, prefix="/api")
    app.include_router(feedback.router, prefix="/api")
    app.include_router(billing.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")
    app.include_router(admin_cookies.router, prefix="/api")
    app.include_router(admin_notifications.router, prefix="/api")
    app.include_router(platform.router, prefix="/api")
    app.include_router(update_logs.router, prefix="/api")
    app.include_router(admin_update_logs.router, prefix="/api")
    app.include_router(note_collection.router, prefix="/api")
    app.include_router(flashcard.router, prefix="/api")

    return app
