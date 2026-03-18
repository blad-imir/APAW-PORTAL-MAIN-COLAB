"""
Persistent cache storage with atomic writes and graceful degradation.
Cache issues should NEVER crash the app - always fall back to API.
"""

import json
import logging
import os
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


class PersistentCache:
    
    # Maximum cache file size in bytes - larger files are auto-deleted on load
    # Prevents MemoryError when loading bloated cache files
    MAX_CACHE_FILE_SIZE = 5 * 1024 * 1024  # 5MB
    
    def __init__(self, cache_dir: str = None):
        self.disabled = False
        self._file_cache_corrupted = False
        
        if cache_dir is None:
            project_root = Path(__file__).parent.absolute()
            self.cache_dir = project_root / 'cache'
        else:
            self.cache_dir = Path(cache_dir)
        
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Cache directory: {self.cache_dir}")
        except Exception as e:
            logger.error(f"Failed to create cache directory: {e}")
            self.disabled = True
            return
        
        self.cache_file = self.cache_dir / "weather_data.json"
        self._cleanup_temp_files()
        self._validate_existing_cache()
    
    def _cleanup_temp_files(self):
        """Remove orphaned temp files from previous failed saves."""
        if self.disabled:
            return
        
        try:
            for pattern in ["weather_*.tmp", "weather_*.old"]:
                for temp_file in self.cache_dir.glob(pattern):
                    try:
                        temp_file.unlink()
                    except Exception:
                        pass
        except Exception:
            pass
    
    def _validate_existing_cache(self):
        """Check if existing cache is valid on startup."""
        if self.disabled or not self.cache_file.exists():
            return
        
        try:
            with open(self.cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)
            
            if not isinstance(cache_data, dict) or 'data' not in cache_data:
                raise ValueError("Invalid cache structure")
            
            data = cache_data.get('data', [])
            logger.info(f"Cache validated: {len(data)} records")
            self._file_cache_corrupted = False
            
        except json.JSONDecodeError as e:
            logger.error(f"Cache file corrupted: {e}")
            self._mark_corrupted_and_attempt_recovery()
        except Exception as e:
            logger.error(f"Cache validation failed: {e}")
            self._mark_corrupted_and_attempt_recovery()
    
    def _mark_corrupted_and_attempt_recovery(self):
        """Mark cache as corrupted and try to delete it."""
        self._file_cache_corrupted = True
        
        try:
            if self.cache_file and self.cache_file.exists():
                self.cache_file.unlink()
                logger.info("Deleted corrupted cache - will fetch fresh data")
                self._file_cache_corrupted = False
        except PermissionError:
            logger.warning("Cache file locked - will use API until file is released")
        except Exception as e:
            logger.warning(f"Could not delete corrupted cache: {e}")
    
    def save(self, data: List[Dict]) -> bool:
        """Save data using atomic write (write to temp file, then rename)."""
        if self.disabled or not data:
            return False
        
        temp_path = None
        try:
            cache_data = {
                'data': data,
                'saved_at': datetime.now().isoformat(),
                'count': len(data)
            }
            
            temp_fd, temp_path = tempfile.mkstemp(
                dir=str(self.cache_dir),
                prefix='weather_',
                suffix='.tmp'
            )
            
            try:
                with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                    json.dump(cache_data, f, separators=(',', ':'))
            except Exception:
                try:
                    os.close(temp_fd)
                except Exception:
                    pass
                raise
            
            if self.cache_file.exists():
                try:
                    self.cache_file.unlink()
                except PermissionError:
                    logger.warning("Cache file locked - save deferred")
                    return False
            
            shutil.move(str(temp_path), str(self.cache_file))
            temp_path = None
            
            if self._file_cache_corrupted:
                logger.info("Cache corruption recovered")
                self._file_cache_corrupted = False
            
            logger.debug(f"Saved {len(data)} records to cache")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save cache: {e}")
            return False
        finally:
            if temp_path:
                try:
                    Path(temp_path).unlink()
                except Exception:
                    pass
    
    def load(self) -> Optional[List[Dict]]:
        """Load data from cache. Returns None if unavailable."""
        if self.disabled or self._file_cache_corrupted:
            return None
        
        try:
            if not self.cache_file or not self.cache_file.exists():
                return None
            
            # Check file size BEFORE loading to prevent MemoryError
            file_size = self.cache_file.stat().st_size
            if file_size > self.MAX_CACHE_FILE_SIZE:
                logger.warning(
                    f"Cache file too large ({file_size / 1024 / 1024:.1f}MB > "
                    f"{self.MAX_CACHE_FILE_SIZE / 1024 / 1024:.1f}MB). "
                    f"Auto-deleting to prevent MemoryError."
                )
                self.clear()
                return None
            
            with open(self.cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)
            
            data = cache_data.get('data', [])
            if not data:
                return None
            
            logger.info(f"Loaded {len(data)} records from cache ({file_size / 1024:.1f}KB)")
            return data
            
        except json.JSONDecodeError as e:
            logger.error(f"Cache corrupted during load: {e}")
            self._mark_corrupted_and_attempt_recovery()
            return None
        except MemoryError:
            logger.error("MemoryError loading cache - file too large. Deleting.")
            self.clear()
            return None
        except Exception as e:
            logger.error(f"Failed to load cache: {e}")
            return None
    
    def clear(self) -> bool:
        """Clear the cache."""
        if self.disabled:
            return True
        
        try:
            if self.cache_file and self.cache_file.exists():
                self.cache_file.unlink()
            self._cleanup_temp_files()
            self._file_cache_corrupted = False
            return True
        except Exception as e:
            logger.error(f"Failed to clear cache: {e}")
            return False
    
    def get_info(self) -> Dict:
        """Get cache status information."""
        if self.disabled:
            return {'exists': False, 'disabled': True}
        
        info = {
            'exists': False,
            'cache_dir': str(self.cache_dir),
            'corrupted': self._file_cache_corrupted,
        }
        
        try:
            if self.cache_file and self.cache_file.exists():
                stat = self.cache_file.stat()
                info.update({
                    'exists': True,
                    'size_kb': round(stat.st_size / 1024, 2),
                    'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
        except Exception as e:
            info['error'] = str(e)
        
        return info