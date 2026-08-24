from app.db import user_notification_dao


class UserNotificationService:
    @staticmethod
    def publish(**kwargs):
        return user_notification_dao.publish(**kwargs)

    @staticmethod
    def list(*, user_id: int, page: int = 1, page_size: int = 20, unread_only: bool = False):
        return user_notification_dao.list_for_user(
            user_id=user_id, page=page, page_size=page_size, unread_only=unread_only
        )

    @staticmethod
    def unread_count(*, user_id: int):
        return user_notification_dao.unread_count(user_id=user_id)

    @staticmethod
    def mark_read(*, user_id: int, notification_id: int):
        return user_notification_dao.mark_read(user_id=user_id, notification_id=notification_id)

    @staticmethod
    def mark_all_read(*, user_id: int):
        return user_notification_dao.mark_all_read(user_id=user_id)
