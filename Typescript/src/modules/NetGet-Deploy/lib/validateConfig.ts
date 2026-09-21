// validateConfig.ts

interface DomainEntry {
    domain: string;
    subdomain: string;
    email: string;
    sslMode: string;
    sslCertificate: string;
    sslCertificateKey: string;
    target: string;
    type: string;
    projectPath: string;
    owner: string;
}

interface DeployConfig {
    server: string;
    timestamp: number;
    domains: DomainEntry[];
}

interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

export function validateDeployConfig(config: DeployConfig): ValidationResult {
    const errors: string[] = [];

    // Validación general
    if (!config.server || typeof config.server !== 'string') {
        errors.push("The 'server' field is required and must be a string.");
    }

    if (!config.timestamp || typeof config.timestamp !== 'number') {
        errors.push("The 'timestamp' field is required and must be a number.");
    }

    if (!Array.isArray(config.domains) || config.domains.length === 0) {
        errors.push("The 'domains' field must be an array with at least one object.");
        return { isValid: errors.length === 0, errors }; // Evita forEach si no es arreglo
    }

    // Campos requeridos para cada dominio
    const requiredFields: (keyof DomainEntry)[] = [
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
            if (!(field in entry) || typeof entry[field] !== 'string' || (entry[field] as string).trim() === '') {
                errors.push(`'${field}' is required and must be a non-empty string in domains[${index}]`);
            }
        });
    });

    return {
        isValid: errors.length === 0,
        errors
    };
}
