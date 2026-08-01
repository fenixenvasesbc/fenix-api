# Purga total del modulo de Fichaje de Horarios (Fenix CRM).
# Elimina TODOS los empleados y TODOS los fichajes registrados. Accion irreversible.
# Requiere iniciar sesion con un usuario de rol ADMIN.

$ApiBaseUrl = "https://api.fenixcrm.site"   # cambia esto si tu API corre en otra URL/puerto
$ConfirmationPhrase = "ELIMINAR TODOS LOS FICHAJES"

function Read-PlainPassword {
    param([string]$Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

Write-Host "==================================================" -ForegroundColor Red
Write-Host " PURGA TOTAL - MODULO DE FICHAJE - FENIX CRM" -ForegroundColor Red
Write-Host "==================================================" -ForegroundColor Red
Write-Host "Esta accion eliminara TODOS los empleados y TODOS los" -ForegroundColor Yellow
Write-Host "fichajes registrados en el modulo. No se puede deshacer." -ForegroundColor Yellow
Write-Host ""

$email = Read-Host "Email de administrador"
$password = Read-PlainPassword "Contrasena"

try {
    $loginBody = @{ email = $email; password = $password } | ConvertTo-Json
    $loginResponse = Invoke-RestMethod -Uri "$ApiBaseUrl/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
    $token = $loginResponse.accessToken
} catch {
    Write-Host "No se pudo iniciar sesion. Revisa el email/contrasena." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}

$headers = @{ Authorization = "Bearer $token" }

try {
    $preview = Invoke-RestMethod -Uri "$ApiBaseUrl/time-tracking/purge/preview" -Method Get -Headers $headers
} catch {
    Write-Host "No se pudo consultar el resumen. Verifica que el usuario tenga rol ADMIN." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}

Write-Host ""
Write-Host "Se van a eliminar de forma permanente:" -ForegroundColor Yellow
Write-Host "  - $($preview.employees) empleados"
Write-Host "  - $($preview.entries) fichajes"
Write-Host ""

if ($preview.employees -eq 0 -and $preview.entries -eq 0) {
    Write-Host "No hay datos que eliminar." -ForegroundColor Green
    Read-Host "Pulsa Enter para salir"
    exit 0
}

Write-Host "Para confirmar, escribe EXACTAMENTE la siguiente frase:" -ForegroundColor Yellow
Write-Host "$ConfirmationPhrase" -ForegroundColor Cyan
$confirmation = Read-Host "Confirmacion"

if ($confirmation -ne $ConfirmationPhrase) {
    Write-Host "Frase incorrecta. Operacion cancelada, no se elimino nada." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}

try {
    $purgeBody = @{ confirmationPhrase = $confirmation } | ConvertTo-Json
    $result = Invoke-RestMethod -Uri "$ApiBaseUrl/time-tracking/purge" -Method Delete -Headers $headers -Body $purgeBody -ContentType "application/json"
    Write-Host ""
    Write-Host "Listo. Se eliminaron $($result.deletedEmployees) empleados y $($result.deletedEntries) fichajes." -ForegroundColor Green
} catch {
    Write-Host "Error al eliminar los datos: $($_.Exception.Message)" -ForegroundColor Red
}

Read-Host "Pulsa Enter para salir"
