import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Key, Eye, EyeOff, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SettingsModal = () => {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const handleSaveApiKey = () => {
    if (!apiKey.trim()) {
      toast({
        title: "API Key Required",
        description: "Please enter your Gemini API key to continue.",
        variant: "destructive",
      });
      return;
    }

    // Store API key in localStorage for this demo
    localStorage.setItem("gemini_api_key", apiKey);
    
    toast({
      title: "API Key Saved",
      description: "Your Gemini API key has been saved successfully.",
    });
    
    setIsOpen(false);
  };

  const loadApiKey = () => {
    const savedKey = localStorage.getItem("gemini_api_key");
    if (savedKey) {
      setApiKey(savedKey);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="text-gray-600 hover:text-green-600 hover:bg-white bg-white " size="sm" onClick={loadApiKey}>
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            API Configuration
          </DialogTitle>
          <DialogDescription>
            Configure your Google Gemini API key to start generating learning resources.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="api-key">Google Gemini API Key</Label>
            <div className="relative">
              <Input
                id="api-key"
                type={showKey ? "text" : "password"}
                placeholder="Enter your Gemini API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Key className="h-4 w-4" />
              How to get your API key:
            </h4>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Visit Google AI Studio</li>
              <li>Sign in with your Google account</li>
              <li>Create a new API key</li>
              <li>Copy and paste it here</li>
            </ol>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => window.open("https://makersuite.google.com/app/apikey", "_blank")}
            >
              <ExternalLink className="h-4 w-4" />
              Get API Key from Google AI Studio
            </Button>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-800">
              <strong>Privacy Note:</strong> Your API key is stored locally in your browser and never sent to our servers. It's used only to make direct requests to Google's Gemini API.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSaveApiKey}>
            Save API Key
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsModal;