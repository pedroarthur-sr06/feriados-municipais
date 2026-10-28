@echo off
rem ===========================================================================
rem  Busca a versao mais nova no GitHub e atualiza esta copia.
rem
rem  Rode quando avisarem que entrou feriado novo ou que a ferramenta mudou.
rem  Nao apaga nada: os seeds sao upsert, entao o que ja existe e atualizado e
rem  o que e novo entra.
rem ===========================================================================

cd /d "%~dp0"
title Atualizar Feriados Municipais

echo.
echo   Atualizando Feriados Municipais
echo   ------------------------------
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo   O Git nao esta instalado nesta maquina, entao nao da para buscar a
  echo   versao nova automaticamente.
  echo.
  echo   Instale em https://git-scm.com e rode este arquivo de novo,
  echo   ou peca uma copia nova para quem cuida do sistema.
  echo.
  pause
  exit /b 1
)

echo   Buscando a versao mais nova...
call git pull
if errorlevel 1 goto erro
echo.

echo   Conferindo dependencias...
call npm.cmd install
if errorlevel 1 goto erro
echo.

echo   Atualizando a base de feriados...
call npm.cmd run db:migrate
if errorlevel 1 goto erro
call npm.cmd run seed:feriados-curados
if errorlevel 1 goto erro
echo.

echo   Pronto. Feche esta janela e abra a ferramenta pelo
echo   "Abrir Feriados Municipais.cmd".
echo.
pause
exit /b 0

:erro
echo.
echo   Alguma coisa falhou acima. Copie a mensagem e mande para quem cuida
echo   do sistema.
echo.
pause
exit /b 1
