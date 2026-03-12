@echo off
echo =======================================================
echo          DaNo Data Annotation Tool Startup
echo =======================================================
echo.

echo [1/3] Building Docker image (this is fast if unchanged)...
docker build -t dano-tool .
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to build Docker image. Is Docker Desktop running?
    pause
    exit /b 1
)

echo.
echo [2/3] Starting backend server container...
docker stop dano-container 2>NUL
docker rm dano-container 2>NUL
docker run -d --name dano-container -p 8000:8000 dano-tool

echo.
echo [3/3] Opening browser to http://localhost:8000...
timeout /t 2 /nobreak >NUL
start http://localhost:8000

echo.
echo The tool is now running!
echo To stop it later, you can run: docker stop dano-container
echo.
pause
