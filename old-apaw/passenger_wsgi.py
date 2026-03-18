import sys, os

sys.path.append("/home2/portalapawcspced/portal")

INTERP = "/home2/portalapawcspced/flaskenv/bin/python3"
if sys.executable != INTERP: os.execl(INTERP, INTERP, *sys.argv)

from app import app as application
