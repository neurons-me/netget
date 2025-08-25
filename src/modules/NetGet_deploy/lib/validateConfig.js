export function validateDeployConfig(config) {
  const errors = [];

  // Validación general
  if (!config.server || typeof config.server !== 'string') {
    errors.push("El campo 'server' es obligatorio y debe ser un string.");
  }

  if (!config.timestamp || typeof config.timestamp !== 'number') {
    errors.push("El campo 'timestamp' es obligatorio y debe ser un número.");
  }

  if (!Array.isArray(config.domains) || config.domains.length === 0) {
    errors.push("El campo 'domains' debe ser un arreglo con al menos un objeto.");
    return { isValid: errors.length === 0, errors }; // Evita forEach si no es arreglo
  }

  // Campos requeridos para cada dominio
  const requiredFields = [
    "domain",
    "subdomain",
    "email",
    "sslMode",
    "sslCertificate",
    "sslCertificateKey",
    "target",
    "type",
    "projectPath",
    "owner"
  ];

  config.domains.forEach((entry, index) => {
    requiredFields.forEach(field => {
      if (!(field in entry) || typeof entry[field] !== 'string' || entry[field].trim() === '') {
        errors.push(`'${field}' es obligatorio y debe ser un string válido en domains[${index}]`);
      }
    });
  });

  return {
    isValid: errors.length === 0,
    errors
  };
}
