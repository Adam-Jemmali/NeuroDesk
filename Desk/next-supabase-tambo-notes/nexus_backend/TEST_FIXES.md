# Test Suite Fixes

## Issues Fixed

1. ✅ **SQLAlchemy `metadata` conflict** - Renamed `metadata` fields to `extra_metadata` in:
   - `app/models/transaction.py`
   - `app/models/audit_log.py`
   - Corresponding schemas

2. ✅ **Missing dependencies**:
   - Added `email-validator==2.2.0` to `requirements.txt`
   - Added `aiosqlite==0.20.0` to `requirements.txt` (for in-memory SQLite testing)

3. ✅ **FastAPI deprecation warnings** - Updated `app/main.py` to use `lifespan` instead of deprecated `on_event`

4. ✅ **Pytest asyncio configuration** - Added `asyncio_default_fixture_loop_scope = function` to `pytest.ini`

5. ✅ **Removed deprecated event_loop fixture** - Removed custom `event_loop` fixture from `conftest.py`

6. ✅ **Password length in tests** - Updated test passwords to be shorter to avoid bcrypt 72-byte limit:
   - `testpassword123` → `testpass123`
   - `securepassword123` → `securepass123`

## Known Issue: passlib bcrypt Bug Detection

**Problem**: passlib's bcrypt handler tries to detect a bug during initialization using a test password that exceeds bcrypt's 72-byte limit, causing `ValueError: password cannot be longer than 72 bytes`.

**Status**: This is a known issue with passlib 1.7.4 and certain bcrypt versions. The bug detection happens during the first password hash operation.

**Workaround Options**:

1. **Upgrade passlib** (if newer version available):
   ```bash
   pip install --upgrade passlib
   ```

2. **Use a different password hashing scheme** (if bcrypt is not required):
   - Consider using `argon2` or `pbkdf2_sha256` instead

3. **Manual patch** (temporary workaround):
   - The test suite includes a patch attempt in `app/services/__init__.py`, but it may not work in all cases

**Current Status**: 
- 6 tests passing ✅
- 7 tests failing due to bcrypt initialization issue ⚠️
- Tests that don't require password hashing work correctly

## Running Tests

```bash
cd nexus_backend
pytest -v
```

To run specific tests that don't require password hashing:
```bash
pytest tests/test_auth.py::test_jwt_token_creation_and_decoding -v
pytest tests/test_auth.py::test_jwt_token_expiry -v
pytest tests/test_auth.py::test_me_endpoint_no_token -v
```

## Next Steps

1. Investigate upgrading passlib or bcrypt versions
2. Consider alternative password hashing libraries
3. Implement a more robust workaround for the bug detection issue
