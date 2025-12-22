---
description: Cómo regresar al último commit en Git (Deshacer cambios)
---

Para regresar tu código al estado del último "guardado" (commit) y borrar todo lo que hayas hecho después, necesitas ejecutar dos comandos en tu terminal.

**⚠️ ADVERTENCIA: Esto borrará permanentemente cualquier cambio no guardado.**

### 1. Deshacer cambios en archivos existentes
Este comando regresa todos los archivos que Git ya conoce a su estado original.
```powershell
git reset --hard HEAD
```

### 2. Borrar archivos nuevos
Este comando elimina los archivos y carpetas nuevos que hayas creado y que Git aún no estaba rastreando.
```powershell
git clean -fd
```
* `-f`: force (forzar el borrado)
* `-d`: directory (borrar también carpetas vacías o nuevas)

### En caso de error "git no reconocido"
Si te sale error de que no reconoce `git`, usa la ruta completa (ajusta según donde lo instalaste):
```powershell
& "C:\Program Files\Git\cmd\git.exe" reset --hard HEAD
& "C:\Program Files\Git\cmd\git.exe" clean -fd
```
