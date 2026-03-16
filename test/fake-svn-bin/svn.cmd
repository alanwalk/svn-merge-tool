@echo off
:: fake-svn-bin/svn.cmd — Windows shim that invokes fake-svn.js as "svn"
:: Put the fake-svn-bin/ directory first in PATH during manual tests.
node "%~dp0\..\fake-svn.js" %*
