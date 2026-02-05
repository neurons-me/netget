import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom"; // If using React Router

const ProtectedRoute = ({ children }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        fetch("https://api.netget.site/check-auth", {
            method: "GET",
            credentials: "include"
        })
            .then(response => response.json())
            .then(data => {
                if (data.authenticated) {
                    setIsAuthenticated(true);
                } else {
                    navigate("/login");
                }
            })
            .catch(() => navigate("/login"))
            .finally(() => setIsLoading(false));
    }, [navigate]);

    if (isLoading) {
        return <div className="spinner"></div>; // Show a loader while checking authentication
    }

    return isAuthenticated ? children : null;
};

export default ProtectedRoute;
