"""
Platform collector base class.
Each platform module must implement a class inheriting from BaseCollector.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Tuple


class BaseCollector(ABC):
    """Base class for all platform collectors."""

    PLATFORM: str = ""

    def __init__(self, browser: str = "chrome"):
        self.browser = browser

    @abstractmethod
    def validate_cookies(self) -> Tuple[bool, Optional[Dict]]:
        """Validate that required cookies exist.
        Returns (is_valid, error_dict_or_none).
        error_dict has keys: code, message.
        """
        pass

    @abstractmethod
    async def collect(self, url: str, max_posts: Optional[int] = None) -> Dict:
        """Collect creator profile and post engagement data.
        Returns structured analytics dict with keys:
            platform, collected_at, account, works, summary.
        """
        pass
