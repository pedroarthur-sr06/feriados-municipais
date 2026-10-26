@echo off
rem ===========================================================================
rem  Sobe a ferramenta e abre no navegador. Dois cliques neste arquivo.
rem
rem  Por que .cmd e nao .ps1: a politica de execucao do PowerShell desta
rem  maquina bloqueia scripts, e ate o "npm" (que e um .ps1) falha por ali.
rem  O cmd.exe chama npm.cmd direto e nao esbarra nisso.
rem
rem  Na primeira vez demora alguns minutos: instala as dependencias e compila.
rem  Nas seguintes sobe em segundos.
rem ===========================================================================

cd /d "%~dp0"
title Feriados Municipais

echo.
echo   Feriados Municipais
echo   -------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   O Node.js nao esta instalado nesta maquina.
  echo.
  echo   Baixe a versao 22 LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   Primeira execucao: instalando dependencias. Isso leva alguns minutos.
  echo.
  call npm.cmd install
  if errorlevel 1 goto erro
  echo.
)

rem Compila sempre. A versao anterior so compilava quando dist/ nao existia, e
rem depois de qualquer alteracao no codigo o atalho subia a build velha —
rem defeito visto no teste. Compilar leva segundos e elimina essa classe de
rem "mexi no codigo e nao mudou nada".
echo   Preparando...
call npm.cmd run build
if errorlevel 1 goto erro
echo.

rem O navegador abre sozinho alguns segundos depois; o servidor segura esta
rem janela, entao a abertura vai para um processo a parte.
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

rem Log so de problema: linha JSON por requisicao assusta quem nao e tecnico.
set LOG_LEVEL=warn
call npm.cmd start
goto fim

:erro
echo.
echo   Alguma coisa falhou acima. Copie a mensagem e mande para quem cuida do sistema.
echo.
pause
exit /b 1

:fim
echo.
echo   Servidor encerrado.
pause
