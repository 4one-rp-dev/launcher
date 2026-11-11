; Дополнения к установщику 4ONE Launcher (NSIS, подключается через nsis.include). Файл в UTF-8 с BOM.
; При удалении (но не при обновлении) спрашиваем, стирать ли данные лаунчера:
;   LOCALAPPDATA\4ONE Launcher - скачанный комплект клиента (~400 МБ);
;   APPDATA\4ONE Launcher      - настройки, вход (зашифрован), журналы.
; Клиент игры в папке GTA V удаляется из самого лаунчера: «Настройки» -> «Удалить клиент».

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; ссылку gta4one:// регистрирует само приложение при запуске — после удаления она вела бы в пустоту
    DeleteRegKey HKCU "Software\Classes\gta4one"
    MessageBox MB_YESNO|MB_ICONQUESTION "Удалить также настройки лаунчера и скачанные файлы клиента (около 400 МБ)?$\r$\n$\r$\nЕсли оставить, при повторной установке не придётся заново входить и скачивать клиент." /SD IDNO IDNO l4_keep_data
      RMDir /r "$LOCALAPPDATA\4ONE Launcher"
      RMDir /r "$APPDATA\4ONE Launcher"
    l4_keep_data:
  ${endIf}
!macroend
