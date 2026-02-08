"""
Services package initialization
"""
# Patch passlib's bcrypt bug detection before auth_service imports it
# This prevents the 72-byte password limit error during bcrypt initialization
try:
    import passlib.handlers.bcrypt as bcrypt_module
    
    # Patch detect_wrap_bug to skip the problematic test
    def patched_detect_wrap_bug(ident):
        """Patched version that skips bug detection to avoid 72-byte limit error"""
        return False
    
    bcrypt_module.detect_wrap_bug = patched_detect_wrap_bug
except Exception:
    # If patching fails, continue anyway
    pass