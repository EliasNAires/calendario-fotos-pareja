// Errores de la fuente de datos que la interfaz trata distinto de un error cualquiera.

/** No hay sesión (nunca se entró, venció o Drive devolvió 401): hay que volver a "Entrar con Google". */
export class AuthError extends Error {
  constructor(message = 'La sesión venció. Entrá de nuevo con Google.') {
    super(message);
    this.name = 'AuthError';
  }
}

/** La cuenta entró bien pero no ve la carpeta del álbum (Drive devolvió 403 o 404). */
export class NoAccessError extends Error {
  /** @param {string} email */
  constructor(email) {
    super('Esta cuenta no tiene acceso al álbum.');
    this.name = 'NoAccessError';
    this.email = email;
  }
}
