; Дополнения к установщику 4ONE Launcher (NSIS, подключается через nsis.include). Файл в UTF-8 с BOM.
;
; Раскладка как у RMRP: всё в одной папке, которую выбирает игрок (по умолчанию C:\4ONE RP):
;   <корень>\Launcher   — лаунчер (сюда ставит этот установщик)
;   <корень>\Game       — клиент игры и файлы серверов (ставит сам лаунчер)
; Корень лаунчер вычисляет как родителя папки Launcher (src/main/layout.js).

!include "FileFunc.nsh"

; Папка по умолчанию — C:\4ONE RP\Launcher. Только если лаунчер ещё не стоял: при обновлении место не меняем.
!macro preInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" 0 l4_has_location
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\4ONE RP\Launcher"
  l4_has_location:
!macroend

; После выбора папки: если игрок указал просто диск или папку (D:\Games), дописываем «\4ONE RP\Launcher»,
; чтобы рядом с лаунчером лёг Game, а не файлы игры вперемешку с чужими.
!macro customPageAfterChangeDir
  Page custom L4FixInstDir
!macroend
!ifndef BUILD_UNINSTALLER ; деинсталлятор собирается тем же скриптом, страниц у него нет
Function L4FixInstDir
  StrCpy $0 $INSTDIR "" -9
  StrCmp $0 "\Launcher" l4_dir_ok
  StrCpy $0 $INSTDIR "" -8
  StrCmp $0 "\4ONE RP" l4_add_launcher
  StrCpy $0 $INSTDIR "" -1
  StrCmp $0 "\" 0 +3
    StrCpy $INSTDIR "$INSTDIR4ONE RP"
    Goto l4_add_launcher
  StrCpy $INSTDIR "$INSTDIR\4ONE RP"
  l4_add_launcher:
  StrCpy $INSTDIR "$INSTDIR\Launcher"
  l4_dir_ok:
  Abort ; страница служебная — не показываем
FunctionEnd
!endif

; При удалении (но не при обновлении):
;  1) игра — <корень>\Game: клиент, моды и файлы серверов (десятки ГБ); перед удалением клиент сам убирает свои
;     три файла из папки GTA V (FloVMP.exe uninstall);
;  2) данные лаунчера — %APPDATA%\4ONE Launcher (настройки, вход) и старый кэш %LOCALAPPDATA%\4ONE Launcher.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; ссылку gta4one:// регистрирует само приложение при запуске — после удаления она вела бы в пустоту
    DeleteRegKey HKCU "Software\Classes\gta4one"
    StrCpy $0 $INSTDIR "" -9
    StrCmp $0 "\Launcher" 0 l4_no_game
    ${GetParent} "$INSTDIR" $R0
    IfFileExists "$R0\Game\*.*" 0 l4_no_game
      MessageBox MB_YESNO|MB_ICONQUESTION "Удалить также игру 4ONE RP — клиент, моды и файлы серверов (папка $R0\Game)?$\r$\n$\r$\nЕсли оставить, при повторной установке ничего не придётся скачивать заново." /SD IDNO IDNO l4_no_game
        IfFileExists "$R0\Game\FloVMP.exe" 0 +2
          ExecWait '"$R0\Game\FloVMP.exe" uninstall --silent'
        RMDir /r "$R0\Game"
        RMDir "$R0"
    l4_no_game:
    MessageBox MB_YESNO|MB_ICONQUESTION "Удалить также настройки лаунчера и сохранённый вход?$\r$\n$\r$\nЕсли оставить, при повторной установке не придётся входить заново." /SD IDNO IDNO l4_keep_data
      RMDir /r "$APPDATA\4ONE Launcher"
      RMDir /r "$LOCALAPPDATA\4ONE Launcher"
    l4_keep_data:
  ${endIf}
!macroend
