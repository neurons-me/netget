# NetGet Multi-Instance Management

This implementation adds support for managing multiple NetGet instances from a single interface, allowing you to manage domains across different NetGet servers.

## Features

### 1. Network Instance Management
- **Add Network Instances**: Connect to different NetGet servers by IP address
- **Connection Testing**: Verify connectivity before adding instances
- **Status Monitoring**: Real-time online/offline status for each instance

### 2. Domain Management per Instance
- **Instance-Specific Domains**: Each network instance maintains its own domain list
- **Real-time Editing**: Edit domain properties directly in the interface
- **Add New Domains**: Create domains specific to each network instance
- **Cross-Instance Navigation**: Easy switching between different network instances

### 3. Enhanced User Experience
- **Visual Status Indicators**: See which instances are online/offline
- **Network Context**: Clear identification of which instance you're managing
- **Seamless Authentication**: Login to specific instances with credentials
- **Connection Management**: Persistent connections to authenticated instances

## Usage Flow

### Adding a Network Instance

1. **Navigate to Networks**: From the main interface, click "Manage Network Instances"
2. **Add New Instance**: Click the "+" button to add a new network
3. **Enter Details**:
   - Network Name: A friendly identifier for the instance
   - IP Address: The server IP where NetGet is running
   - Owner: Person responsible for this instance
4. **Test Connection**: Verify the instance is accessible
5. **Save**: Add the instance to your network list

### Managing Domains on an Instance

1. **Select Network**: From the Networks grid, choose an instance
2. **Authenticate**: Login with your credentials for that instance
3. **Manage Domains**: 
   - View all domains for that specific instance
   - Edit domain properties inline
   - Add new domains specific to this instance
   - Monitor SSL status and configurations

### Multi-Instance Benefits

- **Centralized Management**: Control multiple NetGet deployments from one interface
- **Environment Separation**: Manage production, staging, and development instances separately
- **Team Collaboration**: Different team members can manage different instances
- **Scalability**: Easy to add new NetGet instances as your infrastructure grows

## Technical Implementation

### Frontend Components

- **NetworkGrid.jsx**: Main interface for viewing and connecting to instances
- **NetworkHome.jsx**: Domain management interface for specific instances
- **AddNetwork.jsx**: Form for adding new network instances

### Backend Enhancements

- **Health Check Endpoint**: `/healthcheck` for instance status monitoring
- **Add Domain Endpoint**: `/add-domain` for creating domains on specific instances
- **Instance-Specific Authentication**: Credentials per network instance

### Data Flow

1. **Network Storage**: Instance details stored in localStorage
2. **Authentication**: Per-instance JWT tokens for secure access
3. **API Routing**: Requests directed to specific instance IP addresses
4. **Real-time Updates**: Live status monitoring and domain synchronization

## Configuration

### Network Instance Structure
```json
{
  "networks": {
    "Production Server": {
      "name": "Production Server",
      "ip": "192.168.1.100",
      "owner": "DevOps Team",
      "addedAt": "2025-01-01T00:00:00Z"
    },
    "Development Instance": {
      "name": "Development Instance", 
      "ip": "localhost",
      "owner": "Development Team",
      "addedAt": "2025-01-01T00:00:00Z"
    }
  }
}
```

### API Endpoints per Instance

Each network instance should provide:
- `GET /healthcheck` - Instance status
- `GET /domains` - List domains for this instance
- `POST /login` - Authenticate with this instance
- `PUT /update-domain` - Update domain properties
- `POST /add-domain` - Add new domain to this instance

## Benefits for Your Workflow

1. **Multi-Environment Support**: Easily switch between production, staging, and development
2. **Team Management**: Different instances can be managed by different team members
3. **Centralized Overview**: Single interface to monitor all your NetGet deployments
4. **Scalable Architecture**: Add new instances as your infrastructure grows
5. **Instance Isolation**: Changes to one instance don't affect others

This implementation provides the flexibility to manage multiple NetGet instances while maintaining the simplicity of the original single-instance interface.
