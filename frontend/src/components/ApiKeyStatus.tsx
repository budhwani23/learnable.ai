import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Key, CheckCircle, AlertCircle } from "lucide-react";

const ApiKeyStatus = () => {
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    const checkApiKey = () => {
      const apiKey = localStorage.getItem("gemini_api_key");
      setHasApiKey(!!apiKey);
    };

    checkApiKey();
    
    // Listen for storage changes to update status
    const handleStorageChange = () => checkApiKey();
    window.addEventListener("storage", handleStorageChange);
    
    // Also check periodically in case of same-tab changes
    const interval = setInterval(checkApiKey, 1000);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  return (
    <Badge
      variant={hasApiKey ? "default" : "destructive"}
      className="flex items-center gap-1 bg-green-500 hover:bg-green-500 "
    >
      {hasApiKey ? (
        <>
          <CheckCircle className="h-3 w-3" />
          API Key Configured
        </>
      ) : (
        <>
          <AlertCircle className="h-3 w-3" />
          API Key Required
        </>
      )}
    </Badge>
  );
};

export default ApiKeyStatus;