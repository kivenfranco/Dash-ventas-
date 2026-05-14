"""
Shared FastAPI dependencies for BI Ventas.

vendedor_override(request):
  - If the authenticated user has role "vendedor" and a codigo_vendedor,
    returns that code so endpoints can force-filter to their own data.
  - Returns None for admin users → no forced filter.
"""
from fastapi import Request
from .auth import vendedor_filter


def vendedor_override(request: Request):
    """
    Returns the logged-in vendedor's codigo_vendedor if role == 'vendedor',
    otherwise None (admin sees all).
    """
    return vendedor_filter(request)
