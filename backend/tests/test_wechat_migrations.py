import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.db import migrate_add_wechat_login


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar(self):
        return self.value


class _Connection:
    def __init__(self, existing_columns=()):
        self.existing_columns = set(existing_columns)
        self.statements = []

    def execute(self, statement):
        sql = str(statement)
        self.statements.append(sql)
        if "INFORMATION_SCHEMA.COLUMNS" in sql:
            for column in self.existing_columns:
                if f"COLUMN_NAME = '{column}'" in sql:
                    return _ScalarResult(1)
            return _ScalarResult(None)
        return _ScalarResult(None)

    def commit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _Engine:
    class _Dialect:
        name = "mysql"

    dialect = _Dialect()

    def __init__(self, connection):
        self.connection = connection

    def connect(self):
        return self.connection


def test_mysql_migration_adds_missing_wechat_columns():
    connection = _Connection()

    migrate_add_wechat_login._run_mysql(_Engine(connection))

    alter_statements = [sql for sql in connection.statements if sql.startswith("ALTER TABLE users")]
    assert len(alter_statements) == 2
    assert "ADD COLUMN wechat_openid VARCHAR(64) NULL" in alter_statements[0]
    assert "uk_users_wechat_openid" in alter_statements[0]
    assert "ADD COLUMN wechat_unionid VARCHAR(64) NULL" in alter_statements[1]
    assert "uk_users_wechat_unionid" in alter_statements[1]


def test_mysql_migration_is_idempotent_when_columns_exist():
    connection = _Connection({"wechat_openid", "wechat_unionid"})

    migrate_add_wechat_login._run_mysql(_Engine(connection))

    assert not any(sql.startswith("ALTER TABLE users") for sql in connection.statements)
