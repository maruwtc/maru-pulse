"""Vercel build step: build OpenBB's extension package while site-packages is still writable.

At runtime the deployment is read-only, and OpenBB would otherwise try to (re)build it on import."""

import openbb

openbb.build(lint=False)
print("OpenBB extensions built")
