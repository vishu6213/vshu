param(
    [Parameter(Position = 0)]
    [string]$OperationPath,
    # Serve mode emits the Add-Type P/Invoke assembly once per session, avoiding per-operation compilation.
    [switch]$Serve
)

$ErrorActionPreference = "Stop"
# Progress records would corrupt the one-JSON-response-per-line serve pipe.
$ProgressPreference = "SilentlyContinue"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -ReferencedAssemblies @(
    'System.dll',
    [System.Drawing.Bitmap].Assembly.Location,
    [Windows.Automation.AutomationElement].Assembly.Location,
    [Windows.Automation.AutomationIdentifier].Assembly.Location
) -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class VshuDesktopWin32 {
    // Default proxy discovery needs a typed caller before PowerShell's dynamic stack frames.
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    public static void InitializeAutomation() {
        System.Windows.Automation.ClientSettings.RegisterClientSideProviders(
            new System.Windows.Automation.ClientSideProviderDescription[0]);
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION data;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)]
        public MOUSEINPUT mouse;
        [FieldOffset(0)]
        public KEYBDINPUT keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort virtualKey;
        public ushort scanCode;
        public uint flags;
        public uint time;
        public UIntPtr extraInfo;
    }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool ScreenToClient(IntPtr hwnd, ref POINT point);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hwnd, uint command);

    [DllImport("user32.dll", EntryPoint = "GetClassNameW", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder className, int maxCount);

    [DllImport("user32.dll", EntryPoint = "GetWindowTextW", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int maxCount);

    [DllImport("user32.dll", EntryPoint = "GetWindowTextLengthW")]
    private static extern int GetWindowTextLength(IntPtr hwnd);

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    // A visible top-level window of the process; tooltips, menus and their shadows are transient popups, not targets.
    public static bool IsTargetWindow(IntPtr hwnd, int processId) {
        const uint rootAncestor = 2;
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || !IsWindowVisible(hwnd) || GetAncestor(hwnd, rootAncestor) != hwnd) {
            return false;
        }
        uint ownerProcessId;
        GetWindowThreadProcessId(hwnd, out ownerProcessId);
        if (ownerProcessId != (uint)processId) {
            return false;
        }
        var className = new System.Text.StringBuilder(256);
        GetClassName(hwnd, className, className.Capacity);
        var name = className.ToString();
        return name != "tooltips_class32" && name != "#32768" && name != "SysShadow";
    }

    // Process.MainWindowHandle's rule (first visible unowned window in z-order) without transient popups.
    public static IntPtr FindMainTargetWindow(int processId) {
        const uint ownerWindow = 4;
        var found = IntPtr.Zero;
        EnumWindows((hwnd, _) => {
            if (GetWindow(hwnd, ownerWindow) != IntPtr.Zero || !IsTargetWindow(hwnd, processId)) {
                return true;
            }
            found = hwnd;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    // Reads the caption Windows stores, without sending the target a message, so a hung window cannot block it.
    public static string GetWindowTitle(IntPtr hwnd) {
        var title = new System.Text.StringBuilder(GetWindowTextLength(hwnd) + 1);
        GetWindowText(hwnd, title, title.Capacity);
        return title.ToString();
    }

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT point);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

    // DWMWA_CLOAKED: the shell hides windows on other virtual desktops this way; raising one switches desktops.
    public static bool IsWindowCloaked(IntPtr hwnd) {
        int cloaked;
        return DwmGetWindowAttribute(hwnd, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0;
    }

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern uint SendInput(uint count, INPUT[] inputs, int size);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeoutString(IntPtr hwnd, uint message, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeoutBuffer(IntPtr hwnd, uint message, IntPtr wParam, System.Text.StringBuilder lParam, uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll", EntryPoint = "PostMessageW")]
    public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern int GetDlgCtrlID(IntPtr hwnd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    public static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll")]
    private static extern bool IsHungAppWindow(IntPtr hwnd);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int informationClass, IntPtr information, int length, out int returnLength);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);

    // WM_NULL round trip; SMTO_ABORTIFHUNG returns at once for a window Windows already marks hung.
    public static bool IsWindowHung(IntPtr hwnd, uint timeoutMilliseconds) {
        IntPtr result;
        if (SendMessageTimeout(hwnd, 0, IntPtr.Zero, IntPtr.Zero, 0x0002, timeoutMilliseconds, out result) != IntPtr.Zero) {
            return false;
        }
        const int errorTimeout = 1460;
        // Other failures (a closed window, UIPI refusing an elevated target) are not hangs.
        return Marshal.GetLastWin32Error() == errorTimeout || IsHungAppWindow(hwnd);
    }

    const uint AbortIfHung = 0x0002;
    const uint EditMessageTimeoutMilliseconds = 2000;

    // EM_REPLACESEL: user32 marshals its string across processes and the edit needs no focus; false when it did not answer.
    public static bool ReplaceEditSelection(IntPtr hwnd, string text) {
        IntPtr result;
        return SendMessageTimeoutString(hwnd, 0x00C2, new IntPtr(1), text, AbortIfHung, EditMessageTimeoutMilliseconds, out result) != IntPtr.Zero;
    }

    // WM_GETTEXT, at most maxLength characters; null when the window did not answer.
    public static string GetEditText(IntPtr hwnd, int maxLength) {
        IntPtr length;
        if (SendMessageTimeout(hwnd, 0x000E, IntPtr.Zero, IntPtr.Zero, AbortIfHung, EditMessageTimeoutMilliseconds, out length) == IntPtr.Zero) { return null; }
        if (length.ToInt64() <= 0) { return ""; }
        var capacity = (int)Math.Min(Math.Max(0L, length.ToInt64()), (long)maxLength) + 1;
        var buffer = new System.Text.StringBuilder(capacity);
        IntPtr copied;
        if (SendMessageTimeoutBuffer(hwnd, 0x000D, new IntPtr(capacity), buffer, AbortIfHung, EditMessageTimeoutMilliseconds, out copied) == IntPtr.Zero) { return null; }
        return buffer.ToString();
    }

    // A control message with no pointer arguments; null when the window did not answer.
    public static long? SendControlMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam) {
        IntPtr result;
        if (SendMessageTimeout(hwnd, message, wParam, lParam, AbortIfHung, EditMessageTimeoutMilliseconds, out result) == IntPtr.Zero) { return null; }
        return result.ToInt64();
    }

    // An exact-name search such as CB_FINDSTRINGEXACT, whose string user32 marshals across processes; null when unanswered.
    public static long? FindControlString(IntPtr hwnd, uint message, int start, string name) {
        IntPtr result;
        if (SendMessageTimeoutString(hwnd, message, new IntPtr(start), name, AbortIfHung, EditMessageTimeoutMilliseconds, out result) == IntPtr.Zero) { return null; }
        return result.ToInt64();
    }

    // An item's text through a length/text message pair such as CB_GETLBTEXTLEN/CB_GETLBTEXT; null when unanswered.
    public static string GetControlItemText(IntPtr hwnd, uint lengthMessage, uint textMessage, int index) {
        IntPtr length;
        if (SendMessageTimeout(hwnd, lengthMessage, new IntPtr(index), IntPtr.Zero, AbortIfHung, EditMessageTimeoutMilliseconds, out length) == IntPtr.Zero || length.ToInt64() < 0) { return null; }
        var buffer = new System.Text.StringBuilder((int)length.ToInt64() + 1);
        IntPtr copied;
        if (SendMessageTimeoutBuffer(hwnd, textMessage, new IntPtr(index), buffer, AbortIfHung, EditMessageTimeoutMilliseconds, out copied) == IntPtr.Zero) { return null; }
        return buffer.ToString();
    }

    public static int GetClientHeight(IntPtr hwnd) {
        RECT rect;
        return GetClientRect(hwnd, out rect) ? rect.Bottom - rect.Top : 0;
    }

    // EM_GETSEL as [start, end]; null when the edit did not answer or an offset is past the 16-bit return value.
    public static int[] GetEditSelection(IntPtr hwnd) {
        IntPtr result;
        if (SendMessageTimeout(hwnd, 0x00B0, IntPtr.Zero, IntPtr.Zero, AbortIfHung, EditMessageTimeoutMilliseconds, out result) == IntPtr.Zero) { return null; }
        var packed = result.ToInt64() & 0xFFFFFFFFL;
        if (packed == 0xFFFFFFFFL) { return null; }
        return new[] { (int)(packed & 0xFFFF), (int)(packed >> 16) };
    }

    // One SendInput batch of KEYEVENTF_UNICODE characters, so any layout types them and no other input interleaves.
    public static bool SendUnicodeText(string text) {
        const uint keyboardInput = 1;
        const uint keyUp = 0x0002;
        const uint unicode = 0x0004;
        const byte returnKey = 0x0D;
        const byte tabKey = 0x09;
        var inputs = new List<INPUT>();
        foreach (var unit in text) {
            if (unit == '\r') { continue; }
            // Why: Return and Tab go as keys, as SendKeys sent them, so dialogs and forms act on them.
            if (unit == '\n' || unit == '\t') {
                var key = unit == '\n' ? returnKey : tabKey;
                inputs.Add(KeyboardInput(keyboardInput, key, 0));
                inputs.Add(KeyboardInput(keyboardInput, key, keyUp));
                continue;
            }
            inputs.Add(UnicodeInput(unit, unicode));
            inputs.Add(UnicodeInput(unit, unicode | keyUp));
        }
        var values = inputs.ToArray();
        if (values.Length == 0) { return true; }
        return SendInput((uint)values.Length, values, Marshal.SizeOf(typeof(INPUT))) == (uint)values.Length;
    }

    // Mandatory integrity RID (0x2000 medium, 0x3000 high), or -1 when the process cannot be queried.
    public static int GetProcessIntegrityLevel(int processId) {
        const uint processQueryLimitedInformation = 0x1000;
        const uint tokenQuery = 0x0008;
        const int tokenIntegrityLevel = 25;
        var process = OpenProcess(processQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero) { return -1; }
        var token = IntPtr.Zero;
        var buffer = IntPtr.Zero;
        try {
            if (!OpenProcessToken(process, tokenQuery, out token)) { return -1; }
            int length;
            GetTokenInformation(token, tokenIntegrityLevel, IntPtr.Zero, 0, out length);
            if (length <= 0) { return -1; }
            buffer = Marshal.AllocHGlobal(length);
            if (!GetTokenInformation(token, tokenIntegrityLevel, buffer, length, out length)) { return -1; }
            var sid = Marshal.ReadIntPtr(buffer);
            int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
            if (count <= 0) { return -1; }
            return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
        } finally {
            if (buffer != IntPtr.Zero) { Marshal.FreeHGlobal(buffer); }
            if (token != IntPtr.Zero) { CloseHandle(token); }
            CloseHandle(process);
        }
    }

    private sealed class WindowCapture {
        private readonly object gate = new object();
        private readonly IntPtr hwnd;
        private readonly int width;
        private readonly int height;
        private bool abandoned;
        private System.Drawing.Bitmap result;

        public WindowCapture(IntPtr hwnd, int width, int height) {
            this.hwnd = hwnd;
            this.width = width;
            this.height = height;
        }

        public void Run() {
            System.Drawing.Bitmap bitmap = null;
            try { bitmap = RenderWindow(hwnd, width, height); } catch {}
            lock (gate) {
                if (abandoned) {
                    if (bitmap != null) { bitmap.Dispose(); }
                } else {
                    result = bitmap;
                }
            }
        }

        public System.Drawing.Bitmap Take() {
            lock (gate) {
                abandoned = true;
                return result;
            }
        }
    }

    // Renders the window itself, so covering windows are not captured; null when the render is unusable or too slow.
    public static System.Drawing.Bitmap CaptureWindow(IntPtr hwnd, int width, int height, int timeoutMilliseconds) {
        var capture = new WindowCapture(hwnd, width, height);
        var thread = new System.Threading.Thread(capture.Run);
        thread.IsBackground = true;
        thread.Start();
        // Why: PrintWindow waits on the target's WM_PRINT with no timeout; a stuck render must not stall the serve loop.
        thread.Join(timeoutMilliseconds);
        return capture.Take();
    }

    private static System.Drawing.Bitmap RenderWindow(IntPtr hwnd, int width, int height) {
        var previousDpiContext = IntPtr.Zero;
        try {
            // Per-monitor-aware V2: a DPI-unaware caller would get a scaled rect but a full-size render.
            previousDpiContext = SetThreadDpiAwarenessContext(new IntPtr(-4));
        } catch (EntryPointNotFoundException) {}
        System.Drawing.Bitmap rendered = null;
        try {
            RECT rect;
            if (!GetWindowRect(hwnd, out rect)) { return null; }
            var renderedWidth = rect.Right - rect.Left;
            var renderedHeight = rect.Bottom - rect.Top;
            if (renderedWidth <= 0 || renderedHeight <= 0) { return null; }
            rendered = new System.Drawing.Bitmap(renderedWidth, renderedHeight, System.Drawing.Imaging.PixelFormat.Format32bppRgb);
            var printed = false;
            using (var graphics = System.Drawing.Graphics.FromImage(rendered)) {
                var hdc = graphics.GetHdc();
                try {
                    // PW_RENDERFULLCONTENT includes DirectComposition content (Chromium, Electron, WinUI).
                    printed = PrintWindow(hwnd, hdc, 2);
                } finally {
                    graphics.ReleaseHdc(hdc);
                }
            }
            if (!printed) { return null; }
            var whole = new System.Drawing.Rectangle(0, 0, renderedWidth, renderedHeight);
            if (UniformColor(rendered, whole) >= 0) { return null; }
            // A black client area inside a drawn frame means the content itself did not render.
            var client = GetClientRegion(hwnd, rect, renderedWidth, renderedHeight);
            if (client.Width > 0 && client.Height > 0 && UniformColor(rendered, client) == 0) { return null; }
            if (renderedWidth == width && renderedHeight == height) {
                var result = rendered;
                rendered = null;
                return result;
            }
            // Keep screenshot pixels in the same window coordinate space as element frames and clicks.
            var scaled = new System.Drawing.Bitmap(width, height, System.Drawing.Imaging.PixelFormat.Format32bppRgb);
            using (var graphics = System.Drawing.Graphics.FromImage(scaled)) {
                graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
                graphics.DrawImage(rendered, 0, 0, width, height);
            }
            return scaled;
        } finally {
            if (rendered != null) { rendered.Dispose(); }
            if (previousDpiContext != IntPtr.Zero) { SetThreadDpiAwarenessContext(previousDpiContext); }
        }
    }

    // Uniform 24-bit color of the region, or -1 when it holds more than one color.
    private static int UniformColor(System.Drawing.Bitmap bitmap, System.Drawing.Rectangle region) {
        var data = bitmap.LockBits(region, System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppRgb);
        try {
            var row = new int[region.Width];
            var first = Marshal.ReadInt32(data.Scan0) & 0xFFFFFF;
            for (var y = 0; y < region.Height; y++) {
                Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, row.Length);
                foreach (var pixel in row) {
                    if ((pixel & 0xFFFFFF) != first) { return -1; }
                }
            }
            return first;
        } finally {
            bitmap.UnlockBits(data);
        }
    }

    // Client area in window-bitmap coordinates, clipped to the bitmap; empty when unknown.
    private static System.Drawing.Rectangle GetClientRegion(IntPtr hwnd, RECT window, int width, int height) {
        RECT client;
        var origin = new POINT();
        if (!GetClientRect(hwnd, out client) || !ClientToScreen(hwnd, ref origin)) { return System.Drawing.Rectangle.Empty; }
        var region = new System.Drawing.Rectangle(origin.X - window.Left, origin.Y - window.Top, client.Right - client.Left, client.Bottom - client.Top);
        region.Intersect(new System.Drawing.Rectangle(0, 0, width, height));
        return region;
    }

    public static void SendModifiedClick(byte[] modifiers, uint mouseDown, uint mouseUp) {
        const uint keyboardInput = 1;
        const uint mouseInput = 0;
        const uint keyUp = 0x0002;
        var inputs = new List<INPUT>();
        foreach (var modifier in modifiers) {
            inputs.Add(KeyboardInput(keyboardInput, modifier, 0));
        }
        inputs.Add(MouseInput(mouseInput, mouseDown));
        inputs.Add(MouseInput(mouseInput, mouseUp));
        for (var index = modifiers.Length - 1; index >= 0; index--) {
            inputs.Add(KeyboardInput(keyboardInput, modifiers[index], keyUp));
        }
        var values = inputs.ToArray();
        var sent = SendInput((uint)values.Length, values, Marshal.SizeOf(typeof(INPUT)));
        if (sent != (uint)values.Length) {
            var releases = new List<INPUT>();
            releases.Add(MouseInput(mouseInput, mouseUp));
            for (var index = modifiers.Length - 1; index >= 0; index--) {
                releases.Add(KeyboardInput(keyboardInput, modifiers[index], keyUp));
            }
            var releaseValues = releases.ToArray();
            SendInput((uint)releaseValues.Length, releaseValues, Marshal.SizeOf(typeof(INPUT)));
            throw new InvalidOperationException("SendInput did not complete the modified click");
        }
    }

    private static INPUT KeyboardInput(uint type, byte virtualKey, uint flags) {
        return new INPUT {
            type = type,
            data = new INPUTUNION {
                keyboard = new KEYBDINPUT { virtualKey = virtualKey, flags = flags }
            }
        };
    }

    private static INPUT UnicodeInput(char unit, uint flags) {
        return new INPUT {
            type = 1,
            data = new INPUTUNION {
                keyboard = new KEYBDINPUT { scanCode = unit, flags = flags }
            }
        };
    }

    private static INPUT MouseInput(uint type, uint flags) {
        return new INPUT {
            type = type,
            data = new INPUTUNION {
                mouse = new MOUSEINPUT { flags = flags }
            }
        };
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(string applicationName, System.Text.StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount, int flags, ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr attributeList, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    // Starts an app without handing it the caller's right to take the foreground (design from agent-desktop #615):
    // the desktop shell is its parent, and its first ShowWindow is SW_SHOWNOACTIVATE.
    public static int LaunchWithoutForeground(string executable, string workingDirectory) {
        const uint processCreateProcess = 0x0080;
        const uint extendedStartupInfoPresent = 0x00080000;
        const int procThreadAttributeParentProcess = 0x00020000;
        const int startfUseShowWindow = 0x0001;
        const short swShowNoActivate = 4;
        uint shellProcessId;
        GetWindowThreadProcessId(GetShellWindow(), out shellProcessId);
        if (shellProcessId == 0) {
            throw new InvalidOperationException("no desktop shell is running to start the app under");
        }
        var shell = OpenProcess(processCreateProcess, false, (int)shellProcessId);
        if (shell == IntPtr.Zero) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "could not open the desktop shell process");
        }
        var attributes = IntPtr.Zero;
        var parentHandle = IntPtr.Zero;
        var attributesInitialized = false;
        try {
            var size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref size)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            attributesInitialized = true;
            // CreateProcess reads the handle through this pointer, so it must outlive the call.
            parentHandle = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(parentHandle, shell);
            if (!UpdateProcThreadAttribute(attributes, 0, (IntPtr)procThreadAttributeParentProcess, parentHandle, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            var startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            startup.StartupInfo.dwFlags = startfUseShowWindow;
            startup.StartupInfo.wShowWindow = swShowNoActivate;
            startup.lpAttributeList = attributes;
            PROCESS_INFORMATION process;
            var commandLine = new System.Text.StringBuilder("\"" + executable + "\"");
            if (!CreateProcess(executable, commandLine, IntPtr.Zero, IntPtr.Zero, false, extendedStartupInfoPresent, IntPtr.Zero, workingDirectory, ref startup, out process)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            return process.dwProcessId;
        } finally {
            if (attributesInitialized) { DeleteProcThreadAttributeList(attributes); }
            if (attributes != IntPtr.Zero) { Marshal.FreeHGlobal(attributes); }
            if (parentHandle != IntPtr.Zero) { Marshal.FreeHGlobal(parentHandle); }
            CloseHandle(shell);
        }
    }

    // Bottom of the z-order without activating: the window stays restored and drivable but covers nothing.
    public static bool SendWindowToBack(IntPtr hwnd) {
        const uint swpNoSize = 0x0001;
        const uint swpNoMove = 0x0002;
        const uint swpNoActivate = 0x0010;
        return SetWindowPos(hwnd, new IntPtr(1), 0, 0, 0, 0, swpNoSize | swpNoMove | swpNoActivate);
    }
}
"@

[VshuDesktopWin32]::InitializeAutomation()

$MaxNodes = 1200
$MaxDepth = 64
$TextLimit = 500
$EditReadbackLimit = 1048576
$MaxScreenshotPngBytes = 900000
$MaxScreenshotEdge = 1280
$MinScreenshotScale = 0.25
$JpegScreenshotQuality = 80
$ScreenshotScaleStep = 0.85
# Windows' own hung-window threshold, so a briefly busy app is not reported as hung; still far under the request timeout.
$WindowResponseTimeoutMilliseconds = 5000
$BlockedAppFragments = @(
    "1password",
    "bitwarden",
    "dashlane",
    "lastpass",
    "nordpass",
    "proton pass"
)

$MouseEvents = @{
    LeftDown = 0x0002
    LeftUp = 0x0004
    RightDown = 0x0008
    RightUp = 0x0010
    MiddleDown = 0x0020
    MiddleUp = 0x0040
    Wheel = 0x0800
    HorizontalWheel = 0x01000
}

function Write-VshuJson($Payload) {
    $Payload | ConvertTo-Json -Depth 100 -Compress
}

function New-VshuFrame([double]$X, [double]$Y, [double]$Width, [double]$Height) {
    if ($Width -le 0 -or $Height -le 0) { return $null }
    [pscustomobject]@{ x = $X; y = $Y; width = $Width; height = $Height }
}

function Read-VshuOperation([string]$Path) {
    Get-Content -Raw -Encoding UTF8 -Path $Path | ConvertFrom-Json
}

function ConvertTo-VshuLParam([int]$X, [int]$Y) {
    [IntPtr]((($Y -band 0xffff) -shl 16) -bor ($X -band 0xffff))
}

function ConvertTo-VshuWheelParam([int]$Delta) {
    [IntPtr](($Delta -band 0xffff) -shl 16)
}

function Get-VshuWindowProcesses {
    @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object ProcessName, Id)
}

function Find-VshuProcess([string]$Query) {
    $needle = ""
    if ($null -ne $Query) { $needle = $Query.Trim() }
    if ([string]::IsNullOrWhiteSpace($needle)) { throw 'appNotFound("")' }
    $byPid = $needle.StartsWith("pid:", [System.StringComparison]::OrdinalIgnoreCase)
    if ($byPid) {
        $needle = $needle.Substring(4)
    }

    $parsedProcessId = 0
    $processes = Get-VshuWindowProcesses
    if ([int]::TryParse($needle, [ref]$parsedProcessId)) {
        $match = $processes | Where-Object { $_.Id -eq $parsedProcessId } | Select-Object -First 1
        if ($null -ne $match) {
            Assert-VshuProcessAllowed $match
            return $match
        }
    }
    # Why: a pid: query names one process; matching its digits against window titles would pick another app.
    if ($byPid) { throw "appNotFound(`"$Query`")" }

    $processNeedle = $needle
    if ($processNeedle.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
        $processNeedle = $processNeedle.Substring(0, $processNeedle.Length - 4)
    }

    $match = $processes | Where-Object {
        $_.ProcessName -ieq $processNeedle -or
        "$($_.ProcessName).exe" -ieq $needle -or
        $_.MainWindowTitle -ieq $needle -or
        $_.MainWindowTitle -ilike "*$needle*"
    } | Select-Object -First 1
    if ($null -ne $match) {
        Assert-VshuProcessAllowed $match
        return $match
    }

    throw "appNotFound(`"$Query`")"
}

function Assert-VshuProcessAllowed($Process, [string]$WindowTitle = "") {
    $values = @($Process.ProcessName, $Process.MainWindowTitle, $WindowTitle) | ForEach-Object { ([string]$_).ToLowerInvariant() }
    foreach ($fragment in $BlockedAppFragments) {
        foreach ($value in $values) {
            if ($value.Contains($fragment)) {
                throw "appBlocked(`"$($Process.ProcessName)`")"
            }
        }
    }
}

function Test-VshuBrowserProcess($Process) {
    $name = ([string]$Process.ProcessName).ToLowerInvariant()
    $browserProcesses = @(
        "arc",
        "brave",
        "chrome",
        "chromium",
        "firefox",
        "librewolf",
        "msedge",
        "opera",
        "vivaldi",
        "zen"
    )
    $browserProcesses -contains $name
}

# Why: MainWindowHandle is a z-order guess that moves to a tooltip or another window, so the id the agent holds is the window.
function Resolve-VshuTargetWindow($Process, $WindowId, $WindowIndex) {
    if ($null -ne $WindowIndex -and [int]$WindowIndex -ne 0) {
        throw "windowNotFound(`"$WindowIndex`")"
    }
    if ($null -ne $WindowId) {
        $handle = [IntPtr][int64]$WindowId
        if (-not [VshuDesktopWin32]::IsTargetWindow($handle, [int]$Process.Id)) {
            throw "windowNotFound(`"$WindowId`")"
        }
    } else {
        $handle = [VshuDesktopWin32]::FindMainTargetWindow([int]$Process.Id)
        if ($handle -eq [IntPtr]::Zero) {
            throw "No top-level UI Automation window is available for $($Process.ProcessName)."
        }
    }
    Assert-VshuProcessAllowed $Process ([VshuDesktopWin32]::GetWindowTitle($handle))
    $handle
}

function Get-VshuRootElement($Process, [IntPtr]$WindowHandle) {
    if ([VshuDesktopWin32]::IsWindowHung($WindowHandle, $WindowResponseTimeoutMilliseconds)) {
        throw "window_not_responding: $(Get-VshuAppName $Process) is not responding; nothing was read from or sent to it"
    }
    [Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
}

function Assert-VshuInputAllowed($Process) {
    $targetLevel = [VshuDesktopWin32]::GetProcessIntegrityLevel([int]$Process.Id)
    $ownLevel = [VshuDesktopWin32]::GetProcessIntegrityLevel($PID)
    # Why: UIPI silently drops input to a higher-integrity process; unknown levels proceed as before.
    if ($targetLevel -lt 0 -or $ownLevel -lt 0 -or $targetLevel -le $ownLevel) { return }
    throw "target_elevated: $(Get-VshuAppName $Process) runs as administrator, so Windows blocks input to it from Vshu; no input was sent"
}

function Get-VshuWindowFrame([IntPtr]$WindowHandle, $RootElement) {
    $rect = New-Object VshuDesktopWin32+RECT
    if ([VshuDesktopWin32]::GetWindowRect($WindowHandle, [ref]$rect)) {
        return New-VshuFrame $rect.Left $rect.Top ($rect.Right - $rect.Left) ($rect.Bottom - $rect.Top)
    }

    try {
        $bounds = $RootElement.Current.BoundingRectangle
        if (-not $bounds.IsEmpty) {
            return New-VshuFrame $bounds.X $bounds.Y $bounds.Width $bounds.Height
        }
    } catch {}
    $null
}

function Get-VshuAppName($Process) {
    if ($Process.ProcessName -eq "ApplicationFrameHost" -and -not [string]::IsNullOrWhiteSpace($Process.MainWindowTitle)) {
        return [string]$Process.MainWindowTitle
    }
    [string]$Process.ProcessName
}

function New-VshuAppRecord($Process) {
    [pscustomobject]@{
        name = Get-VshuAppName $Process
        bundleIdentifier = $Process.ProcessName
        bundleId = $Process.ProcessName
        pid = [int]$Process.Id
    }
}

function Invoke-VshuWindowPatternActivation($RootElement) {
    # Why: reapplying the current visual state lets the window's provider activate it when Windows refuses our raise (agent-desktop #651).
    # Only for maximized windows: re-applying Normal restores a snapped window's pre-snap size.
    try {
        $pattern = $RootElement.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern)
        $maximized = [Windows.Automation.WindowVisualState]::Maximized
        if ($pattern.Current.WindowVisualState -eq $maximized) { $pattern.SetWindowVisualState($maximized) }
    } catch {}
}

# Brings only the target window to the front; returns $null once it is the foreground window, otherwise why not.
function Restore-VshuWindow([IntPtr]$Handle, $RootElement) {
    if ([VshuDesktopWin32]::IsWindowCloaked($Handle)) {
        return "it is on another virtual desktop, and raising it would switch the user's desktop"
    }
    # Why: SW_RESTORE also un-maximizes, which moves the frame the agent targeted.
    if ([VshuDesktopWin32]::IsIconic($Handle)) {
        [void][VshuDesktopWin32]::ShowWindow($Handle, 9)
    }
    if (Test-VshuWindowFocused $Handle) { return $null }
    # Why: Windows often refuses a background process's raise; after one refusal try the UIA route, then one more raise.
    [void][VshuDesktopWin32]::SetForegroundWindow($Handle)
    if (Wait-VshuWindowFocused $Handle 250) { return $null }
    Invoke-VshuWindowPatternActivation $RootElement
    if (Wait-VshuWindowFocused $Handle 250) { return $null }
    [void][VshuDesktopWin32]::SetForegroundWindow($Handle)
    if (Wait-VshuWindowFocused $Handle 250) { return $null }
    "Windows refused to bring it to the front"
}

function Test-VshuTargetTookForeground([IntPtr]$Before, $Process) {
    $after = [VshuDesktopWin32]::GetForegroundWindow()
    if ($after -eq $Before) { return $false }
    $owner = [uint32]0
    [void][VshuDesktopWin32]::GetWindowThreadProcessId($after, [ref]$owner)
    $owner -eq $Process.Id
}

function Test-VshuWindowFocused([IntPtr]$WindowHandle) {
    [VshuDesktopWin32]::GetForegroundWindow() -eq $WindowHandle
}

function Wait-VshuWindowFocused([IntPtr]$WindowHandle, [int]$TimeoutMilliseconds) {
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    while ($stopwatch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        if (Test-VshuWindowFocused $WindowHandle) { return $true }
        Start-Sleep -Milliseconds 50
    }
    Test-VshuWindowFocused $WindowHandle
}

function Assert-VshuKeyboardFocus([IntPtr]$WindowHandle, $Operation, $RestoreFailure = $null, $Process = $null) {
    if (Test-VshuWindowFocused $WindowHandle) { return }
    if ([bool]$Operation.restoreWindow) {
        $reason = if ($null -ne $RestoreFailure) { " ($RestoreFailure)" } else { "" }
        throw "window_not_focused: keyboard input requires the target window to be focused; restoreWindow was requested but the target window is still not focused$reason, so nothing was sent; ask the user to bring it forward or check desktop permissions"
    }
    $verb = ([string]$Operation.tool) -replace "_", "-"
    $alternative = if ($Operation.tool -in @("type_text", "paste_text")) {
        "To enter text in the background, use type-text --element-index <field> or set-value."
    } else {
        "To press a button in the background, click it with click --element-index; to enter text, use type-text --element-index <field>."
    }
    throw (New-VshuForegroundRefusal $Process "$verb sends keys, which go only to the window in front" $alternative "takes the user's keyboard")
}

# Raises the target for real mouse input, then returns its frame read after the raise (restoring moves it).
function Restore-VshuPointerWindow($Process, [IntPtr]$WindowHandle, $RootElement) {
    $failure = Restore-VshuWindow $WindowHandle $RootElement
    if ($null -ne $failure) {
        throw "window_not_focused: restoreWindow was requested but $(Get-VshuAppName $Process) did not come to the front ($failure); no pointer input was sent"
    }
    Get-VshuWindowFrame $WindowHandle $RootElement
}

function New-VshuForegroundRefusal($Process, [string]$Need, [string]$Alternative = "", [string]$Takes = "moves the user's pointer") {
    $hint = if ([string]::IsNullOrEmpty($Alternative)) { "" } else { " $Alternative" }
    "background_unavailable: $Need, which on Windows brings $(Get-VshuAppName $Process) to the front and $Takes; nothing was sent.$hint Ask the user before retrying with --restore-window."
}

function Get-VshuCursorPosition {
    $point = New-Object VshuDesktopWin32+POINT
    if ([VshuDesktopWin32]::GetCursorPos([ref]$point)) { return $point }
    $null
}

function Restore-VshuCursorPosition($Point) {
    if ($null -eq $Point) { return }
    # Why: injected input is handled asynchronously and apps read the live cursor while handling it (context menus, hover);
    # Windows gives no signal when they are done.
    Start-Sleep -Milliseconds 200
    [void][VshuDesktopWin32]::SetCursorPos($Point.X, $Point.Y)
}

function Get-VshuElementFrame($Element, $WindowFrame) {
    try {
        $bounds = $Element.Current.BoundingRectangle
        if ($bounds.IsEmpty) { return $null }
        if ($null -eq $WindowFrame) {
            return New-VshuFrame $bounds.X $bounds.Y $bounds.Width $bounds.Height
        }
        New-VshuFrame ($bounds.X - $WindowFrame.x) ($bounds.Y - $WindowFrame.y) $bounds.Width $bounds.Height
    } catch {
        $null
    }
}

function Get-VshuProperty($Element, [string]$Name) {
    try { [string]$Element.Current.$Name } catch { "" }
}

function Get-VshuRuntimeId($Element) {
    try { @($Element.GetRuntimeId()) } catch { @() }
}

function Test-VshuSensitiveElement($Element) {
    try {
        if ($Element.Current.IsPassword) { return $true }
    } catch {}
    $controlType = try { [string]$Element.Current.ControlType.ProgrammaticName } catch { "" }
    $parts = @(
        (Get-VshuProperty $Element "LocalizedControlType"),
        $controlType,
        (Get-VshuProperty $Element "Name"),
        (Get-VshuProperty $Element "AutomationId"),
        (Get-VshuProperty $Element "ClassName")
    )
    $haystack = (($parts -join " ") -replace "\s+", " ").ToLowerInvariant()
    foreach ($term in @("password", "passcode", "secret", "one-time code", "verification code")) {
        if ($haystack.Contains($term)) { return $true }
    }
    $haystack -match "(^|[^a-z0-9])pin([^a-z0-9]|$)"
}

function Get-VshuValueText($Element) {
    try {
        if (Test-VshuSensitiveElement $Element) { return "[redacted]" }
        $pattern = $Element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
        $rawValue = $pattern.Current.Value
        $text = if ($null -eq $rawValue) { "" } else { [string]$rawValue }
        if ($text.Length -gt $TextLimit) { return $text.Substring(0, $TextLimit) + "..." }
        $text
    } catch {
        ""
    }
}

function Test-VshuNativeClass([string]$ClassName, [string]$BaseClass) {
    # Why: WinForms controls are superclasses named WindowsForms10.<BASE>.app..., and answer the base class's messages.
    $ClassName -match "^(?:WindowsForms\d+\.)?(?:$BaseClass)(?:\.|$)"
}

function Test-VshuEditClass([string]$ClassName) {
    # Why: user32 edits and RichEdit answer EM_ and WM_GETTEXT messages from other processes.
    Test-VshuNativeClass $ClassName "Edit|RichEdit\w*"
}

# Only for elements Get-VshuValueText left empty, so never a sensitive one (it answers "[redacted]" for those).
function Get-VshuEditValueText([IntPtr]$Handle) {
    # Why: the client-side edit proxy gives a multiline edit (Notepad's document) no ValuePattern, so its text is read directly.
    $text = [VshuDesktopWin32]::GetEditText($Handle, $TextLimit + 1)
    if ($null -eq $text) { return "" }
    if ($text.Length -gt $TextLimit) { return $text.Substring(0, $TextLimit) + "..." }
    $text
}

function Get-VshuNativeEdit($Element, $Process) {
    $className = Get-VshuProperty $Element "ClassName"
    if (-not (Test-VshuEditClass $className)) { return $null }
    $handle = try { [IntPtr][int64]$Element.Current.NativeWindowHandle } catch { [IntPtr]::Zero }
    if ($handle -eq [IntPtr]::Zero) { return $null }
    [pscustomobject]@{
        handle = $handle
        processId = [int]$Process.Id
        rich = $className -match "RichEdit"
        sensitive = Test-VshuSensitiveElement $Element
    }
}

function Assert-VshuWindowOwner([IntPtr]$Handle, [int]$ProcessId) {
    # Why: a window handle can be recycled for another process between the tree read and the message.
    $owner = [uint32]0
    if ([VshuDesktopWin32]::IsWindow($Handle)) {
        [void][VshuDesktopWin32]::GetWindowThreadProcessId($Handle, [ref]$owner)
    }
    if ($owner -ne $ProcessId) {
        throw "stale element: the control's window no longer belongs to the target app; run get-app-state again and use a fresh element index"
    }
}

# The element's own window when it is a native control of BaseClass owned by the target process.
function Get-VshuNativeControl($Element, $Process, [string]$BaseClass) {
    if (-not (Test-VshuNativeClass (Get-VshuProperty $Element "ClassName") $BaseClass)) { return $null }
    $handle = try { [IntPtr][int64]$Element.Current.NativeWindowHandle } catch { [IntPtr]::Zero }
    if ($handle -eq [IntPtr]::Zero) { return $null }
    Assert-VshuWindowOwner $handle ([int]$Process.Id)
    $handle
}

function ConvertTo-VshuEditNewlines([string]$Text, [bool]$Collapse) {
    $normalized = $Text -replace "`r`n|`r", "`n"
    if ($Collapse) { return $normalized }
    $normalized -replace "`n", "`r`n"
}

function Invoke-VshuEditTextInsertion($Edit, [int]$Index, [string]$Text, [switch]$ReplaceAll) {
    Assert-VshuWindowOwner $Edit.handle $Edit.processId
    $style = [VshuDesktopWin32]::GetWindowLong($Edit.handle, -16)
    if (($style -band 0x0800) -ne 0) { throw "element $Index text is not settable: the field is read-only" }
    $insert = ConvertTo-VshuEditNewlines $Text $false
    $before = if ($Edit.sensitive) { $null } else { [VshuDesktopWin32]::GetEditText($Edit.handle, $EditReadbackLimit) }
    $selection = [VshuDesktopWin32]::GetEditSelection($Edit.handle)
    # Why: an edit cuts text past its EM_SETLIMITTEXT limit, which would leave a partial write; refuse it untouched instead.
    $limit = [VshuDesktopWin32]::SendControlMessage($Edit.handle, 0x00D5, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($null -ne $limit -and $limit -gt 0) {
        # Why: RichEdit counts a line break as one character, so its lengths are compared without CRLF.
        # Why: a readback cut at the read limit holds only a prefix, so the field reports its own length then.
        $current = if ($null -ne $before -and $before.Length -lt $EditReadbackLimit) { (ConvertTo-VshuEditNewlines $before $Edit.rich).Length } else { [VshuDesktopWin32]::SendControlMessage($Edit.handle, 0x000E, [IntPtr]::Zero, [IntPtr]::Zero) }
        $replaced = if ($ReplaceAll) { $current } elseif ($null -ne $selection) { [Math]::Abs($selection[1] - $selection[0]) } else { 0 }
        $length = $current - $replaced + (ConvertTo-VshuEditNewlines $Text $Edit.rich).Length
        if ($null -ne $current -and $length -gt $limit) { throw "element $Index text is not settable: the result would be $length characters, past the field's $limit-character limit" }
    }
    Assert-VshuWindowOwner $Edit.handle $Edit.processId
    if (-not [VshuDesktopWin32]::ReplaceEditSelection($Edit.handle, $insert)) {
        throw "window_not_responding: the text field did not answer the insertion in time; the text may still land, so run get-app-state before retrying"
    }
    $action = [pscustomobject]@{ path = "accessibility"; actionName = "EM_REPLACESEL"; fallbackReason = $null; verification = [pscustomobject]@{ state = "unverified"; reason = "readback_unsupported" } }
    $after = if ($null -eq $before) { $null } else { [VshuDesktopWin32]::GetEditText($Edit.handle, $EditReadbackLimit) }
    # Why: a text past the read limit can't show the whole result, so it neither proves nor disproves the insertion.
    if ($null -eq $after -or $before.Length -ge $EditReadbackLimit -or $after.Length -ge $EditReadbackLimit) { return $action }
    # Why: RichEdit counts a line break as one character in its selection but may read it back as CRLF.
    $current = if ($Edit.rich) { ConvertTo-VshuEditNewlines $before $true } else { $before }
    $actual = if ($Edit.rich) { ConvertTo-VshuEditNewlines $after $true } else { $after }
    $expected = $null
    if ($null -ne $selection -and [Math]::Max($selection[0], $selection[1]) -le $current.Length) {
        $start = [Math]::Min($selection[0], $selection[1])
        $end = [Math]::Max($selection[0], $selection[1])
        $expected = $current.Substring(0, $start) + (ConvertTo-VshuEditNewlines $Text $Edit.rich) + $current.Substring($end)
    }
    if ($null -ne $expected -and $actual -ceq $expected) {
        $action.verification = [pscustomobject]@{ state = "verified"; property = "elementText" }
    } elseif ($after -ceq $before) {
        throw "text_insertion_unconfirmed: element $Index did not change after the insertion; run get-app-state to check the field before retrying"
    } elseif ($null -ne $expected) {
        $action.verification = [pscustomobject]@{ state = "unverified"; reason = "text_mismatch" }
    }
    $action
}

function Set-VshuTextCaret($Element, [string]$Leading) {
    # Why: a ValuePattern write resets WPF's caret to the start, so the next insertion would land there.
    try {
        # Why: UIA moves by caret positions, which keep a surrogate pair, a combining sequence and a CRLF together.
        $positions = (New-Object Globalization.StringInfo $Leading).LengthInTextElements - ([regex]::Matches($Leading, "`r`n")).Count
        $start = [Windows.Automation.Text.TextPatternRangeEndpoint]::Start
        $end = [Windows.Automation.Text.TextPatternRangeEndpoint]::End
        $leadingRange = $Element.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern).DocumentRange.Clone()
        $leadingRange.MoveEndpointByRange($end, $leadingRange, $start)
        [void]$leadingRange.MoveEndpointByUnit($end, [Windows.Automation.Text.TextUnit]::Character, $positions)
        # Why: a provider that counts positions differently would put the caret elsewhere, so only a confirmed prefix moves it.
        if ($leadingRange.GetText(-1) -cne $Leading) { return }
        $leadingRange.MoveEndpointByRange($start, $leadingRange, $end)
        $leadingRange.Select()
    } catch {}
}

function Get-VshuTextSelectionOffsets($Element) {
    try {
        $text = $Element.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern)
        $ranges = @($text.GetSelection())
        if ($ranges.Count -ne 1) { return $null }
        $leading = $text.DocumentRange.Clone()
        $leading.MoveEndpointByRange([Windows.Automation.Text.TextPatternRangeEndpoint]::End, $ranges[0], [Windows.Automation.Text.TextPatternRangeEndpoint]::Start)
        $start = $leading.GetText(-1).Length
        @($start, ($start + $ranges[0].GetText(-1).Length))
    } catch {
        $null
    }
}

function Invoke-VshuValueTextInsertion($Element, [int]$Index, [string]$Text) {
    $pattern = try { $Element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern) } catch { $null }
    if ($null -eq $pattern) { return $null }
    if ($pattern.Current.IsReadOnly) { throw "element $Index text is not settable: the field is read-only" }
    # Why: Chromium applies a value write as replaced inner text, which editors with their own model miss or revert.
    if ((Get-VshuProperty $Element "FrameworkId") -eq "Chrome") { return $null }
    if (Test-VshuSensitiveElement $Element) {
        throw "element $Index text is not settable at its caret: it is a password field, whose text can't be read; use set-value to replace it"
    }
    $current = [string]$pattern.Current.Value
    $selection = Get-VshuTextSelectionOffsets $Element
    # Why: without a readable selection the caret is unknown; appending matches macOS's default insertion point.
    if ($null -eq $selection -or $selection[1] -gt $current.Length) { $selection = @($current.Length, $current.Length) }
    $next = $current.Substring(0, $selection[0]) + $Text + $current.Substring($selection[1])
    $pattern.SetValue($next)
    # Why: Chromium applies the write asynchronously, so poll briefly like the range readback.
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        $actual = try { [string]$pattern.Current.Value } catch { $null }
        if ($actual -ceq $next -or $stopwatch.ElapsedMilliseconds -ge 500) { break }
        Start-Sleep -Milliseconds 25
    }
    if ($actual -ceq $next) { Set-VshuTextCaret $Element ($current.Substring(0, $selection[0]) + $Text) }
    $verification = if ($actual -ceq $next) {
        [pscustomobject]@{ state = "verified"; property = "elementText" }
    } elseif ($null -eq $actual) {
        [pscustomobject]@{ state = "unverified"; reason = "readback_unsupported" }
    } elseif ($actual -ceq $current) {
        [pscustomobject]@{ state = "unverified"; reason = "accessibility_action_unasserted" }
    } else {
        [pscustomobject]@{ state = "unverified"; reason = "text_mismatch" }
    }
    [pscustomobject]@{ path = "accessibility"; actionName = "setValue"; fallbackReason = $null; verification = $verification }
}

function Test-VshuTextPatternReadOnly($Element) {
    try {
        $range = $Element.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern).DocumentRange
        $range.GetAttributeValue([Windows.Automation.TextPattern]::IsReadOnlyAttribute) -eq $true
    } catch {
        $false
    }
}

function Invoke-VshuElementTextInsertion($Element, $Record, $Process, [IntPtr]$WindowHandle, $RootElement, $Operation, [string]$Text) {
    if ($null -eq $Element) {
        throw "stale element: element $($Record.index) is gone; run get-app-state again and use a fresh element index"
    }
    $index = [int]$Record.index
    # Why: edit messages bypass a disabled field's lock, which set-value's UI Automation write honours.
    if (Test-VshuElementDisabled $Element) { throw "element $index text is not settable: the field is disabled" }
    $edit = Get-VshuNativeEdit $Element $Process
    if ($null -ne $edit) { return Invoke-VshuEditTextInsertion $edit $index $Text }
    # Why: list and tree items also take ValuePattern, where a write renames them rather than typing.
    $controlType = try { [string]$Element.Current.ControlType.ProgrammaticName } catch { "" }
    if ($controlType -notin @("ControlType.Edit", "ControlType.Document")) {
        throw "element $index text is not settable: it is not a text field"
    }
    $action = Invoke-VshuValueTextInsertion $Element $index $Text
    if ($null -ne $action) { return $action }
    # Why: a read-only document with no ValuePattern (WPF RichTextBox) says so only through TextPattern; keys would do nothing.
    if (Test-VshuTextPatternReadOnly $Element) { throw "element $index text is not settable: the field is read-only" }
    if (-not [bool]$Operation.restoreWindow) {
        throw (New-VshuForegroundRefusal $Process "element $index accepts text only as keys, which go only to the window in front" "" "takes the user's keyboard")
    }
    $failure = Restore-VshuWindow $WindowHandle $RootElement
    Assert-VshuKeyboardFocus $WindowHandle $Operation $failure $Process
    try { $Element.SetFocus() } catch {
        throw "window_not_focused: element $index did not take keyboard focus; no text was sent"
    }
    Send-VshuText $WindowHandle $Text
    [pscustomobject]@{ path = "synthetic"; actionName = "typeText"; fallbackReason = "actionUnsupported"; verification = [pscustomobject]@{ state = "unverified"; reason = "synthetic_input" } }
}

function Get-VshuRangeValueText($Element) {
    try {
        $pattern = $Element.GetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern)
        ([double]$pattern.Current.Value).ToString([Globalization.CultureInfo]::InvariantCulture)
    } catch {
        ""
    }
}

function Test-VshuRangeValueWritable($Element) {
    try {
        -not $Element.GetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern).Current.IsReadOnly
    } catch {
        $false
    }
}

function Get-VshuExpandCollapseActions($Element) {
    try {
        $state = $Element.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Current.ExpandCollapseState
    } catch {
        return @()
    }
    switch ($state) {
        ([Windows.Automation.ExpandCollapseState]::Collapsed) { return @("Expand") }
        ([Windows.Automation.ExpandCollapseState]::Expanded) { return @("Collapse") }
        ([Windows.Automation.ExpandCollapseState]::PartiallyExpanded) { return @("Expand", "Collapse") }
    }
    @()
}

function Get-VshuActions($Element, $Patterns = $null) {
    if ($null -eq $Patterns) { $Patterns = @($Element.GetSupportedPatterns()) }
    $actions = New-Object System.Collections.Generic.List[string]
    foreach ($pattern in $Patterns) {
        $name = [string]$pattern.ProgrammaticName
        if ($name -like "InvokePatternIdentifiers.Pattern") { $actions.Add("Invoke") }
        elseif ($name -like "TogglePatternIdentifiers.Pattern") { $actions.Add("Toggle") }
        elseif ($name -like "SelectionItemPatternIdentifiers.Pattern") { $actions.Add("Select") }
        elseif ($name -like "ScrollPatternIdentifiers.Pattern") { $actions.Add("Scroll") }
        elseif ($name -like "ValuePatternIdentifiers.Pattern") { $actions.Add("SetValue") }
        elseif ($name -like "RangeValuePatternIdentifiers.Pattern") { if (Test-VshuRangeValueWritable $Element) { $actions.Add("SetValue") } }
        elseif ($name -like "ExpandCollapsePatternIdentifiers.Pattern") { foreach ($action in @(Get-VshuExpandCollapseActions $Element)) { $actions.Add($action) } }
        elseif ($name -like "ScrollItemPatternIdentifiers.Pattern") { $actions.Add("ScrollToVisible") }
    }
    @($actions | Select-Object -Unique)
}

function Get-VshuMeaningfulActions($Actions) {
    $noisy = @("Invoke", "ScrollToVisible", "ShowMenu")
    @($Actions | Where-Object { $noisy -notcontains $_ })
}

function Format-VshuSnapshotText([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
    (($Text -replace "\s+", " ").Trim())
}

function Format-VshuValueSegment([string]$RoleKey, [string]$Title, [string]$Value) {
    $clean = Format-VshuSnapshotText $Value
    if ([string]::IsNullOrWhiteSpace($clean) -or $clean -eq $Title) { return "" }
    if ($RoleKey -eq "heading" -and $clean -match "^\d+$") { return "" }
    if ($RoleKey -in @("text", "edit", "document", "scroll bar", "progress bar")) {
        return " $clean"
    }
    ", Value: $clean"
}

function Test-VshuSuppressChildren([string]$RoleKey, [string]$Title, [string]$Value, [string]$Summary) {
    $hasCompactLabel = -not [string]::IsNullOrWhiteSpace($Title) -or -not [string]::IsNullOrWhiteSpace((Format-VshuSnapshotText $Value)) -or -not [string]::IsNullOrWhiteSpace((Format-VshuSnapshotText $Summary))
    $hasCompactLabel -and $RoleKey -in @(
        "button",
        "check box",
        "combo box",
        "heading",
        "hyperlink",
        "link",
        "menu item",
        "radio button",
        "tab item"
    )
}

function Get-VshuTextSnippets($Element, [int]$Limit = 6, [int]$MaxDepth = 3) {
    $values = New-Object System.Collections.Generic.List[string]
    $seen = New-Object System.Collections.Generic.HashSet[string]

    function Visit-VshuText($Node, [int]$Depth) {
        if ($values.Count -ge $Limit -or $Depth -gt $MaxDepth) { return }
        $role = try { [string]$Node.Current.LocalizedControlType } catch { "" }
        if ($role -match "text|link|label") {
            foreach ($raw in @((Get-VshuProperty $Node "Name"), (Get-VshuValueText $Node))) {
                $value = (($raw -replace "\s+", " ").Trim())
                if (-not [string]::IsNullOrWhiteSpace($value) -and $seen.Add($value)) {
                    if ($value.Length -gt 80) { $value = $value.Substring(0, 80) + "..." }
                    $values.Add($value)
                    if ($values.Count -ge $Limit) { return }
                }
            }
        }
        try {
            $children = $Node.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
            for ($i = 0; $i -lt $children.Count; $i++) {
                Visit-VshuText $children.Item($i) ($Depth + 1)
                if ($values.Count -ge $Limit) { return }
            }
        } catch {}
    }

    Visit-VshuText $Element 0
    @($values.ToArray())
}

function Test-VshuPlainTextSubtree($Element, [int]$MaxDepth = 4) {
    $script:sawVshuText = $false
    $allowed = @("pane", "group", "custom", "unknown", "text", "link", "image")

    function Visit-VshuPlainText($Node, [int]$Depth) {
        if ($Depth -gt $MaxDepth) { return $false }
        $role = try { [string]$Node.Current.LocalizedControlType } catch { "" }
        $roleKey = $role.ToLowerInvariant()
        if ($allowed -notcontains $roleKey) { return $false }
        if ($roleKey -match "text|link") { $script:sawVshuText = $true }
        if (@(Get-VshuMeaningfulActions @(Get-VshuActions $Node)).Count -gt 0) { return $false }
        try {
            $children = $Node.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
            for ($i = 0; $i -lt $children.Count; $i++) {
                if (-not (Visit-VshuPlainText $children.Item($i) ($Depth + 1))) { return $false }
            }
        } catch {}
        return $true
    }

    (Visit-VshuPlainText $Element 0) -and $script:sawVshuText
}

function New-VshuElementRecord($Element, [int]$Index, $WindowFrame) {
    $controlType = try { [string]$Element.Current.ControlType.ProgrammaticName } catch { "" }
    $nativeWindowHandle = try { [int64]$Element.Current.NativeWindowHandle } catch { 0 }
    $className = Get-VshuProperty $Element "ClassName"
    $patterns = @($Element.GetSupportedPatterns())
    $value = Get-VshuValueText $Element
    if ([string]::IsNullOrEmpty($value) -and $patterns -contains [Windows.Automation.RangeValuePattern]::Pattern) {
        $value = Get-VshuRangeValueText $Element
    }
    if ([string]::IsNullOrEmpty($value) -and $nativeWindowHandle -ne 0 -and (Test-VshuEditClass $className)) {
        $value = Get-VshuEditValueText ([IntPtr]$nativeWindowHandle)
    }
    [pscustomobject]@{
        index = $Index
        runtimeId = @(Get-VshuRuntimeId $Element)
        automationId = Get-VshuProperty $Element "AutomationId"
        name = Get-VshuProperty $Element "Name"
        controlType = $controlType
        localizedControlType = Get-VshuProperty $Element "LocalizedControlType"
        className = $className
        value = $value
        isSelected = Test-VshuElementSelected $Element
        isDisabled = Test-VshuElementDisabled $Element
        nativeWindowHandle = $nativeWindowHandle
        frame = Get-VshuElementFrame $Element $WindowFrame
        actions = @(Get-VshuActions $Element $patterns)
    }
}

function Test-VshuElementDisabled($Element) {
    try { return -not [bool]$Element.Current.IsEnabled } catch { return $false }
}

function Test-VshuElementSelected($Element) {
    try {
        $pattern = $Element.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
        return [bool]$pattern.Current.IsSelected
    } catch {
        return $false
    }
}

function Render-VshuTree($RootElement, $WindowFrame, [bool]$CompactBrowserTabs = $false) {
    $records = New-Object System.Collections.Generic.List[object]
    $lines = New-Object System.Collections.Generic.List[string]
    $seen = New-Object System.Collections.Generic.HashSet[string]
    $truncation = [pscustomobject]@{
        truncated = $false
        maxNodes = $MaxNodes
        maxDepth = $MaxDepth
        maxDepthReached = $false
    }
    # Tab compaction shrinks records mid-walk, so $records.Count would reuse retained indexes.
    $nextIndex = [ref]0

    function Visit-VshuChildren($Children, [int]$Depth) {
        for ($i = 0; $i -lt $Children.Count; $i++) {
            if ($records.Count -ge $MaxNodes -or $Depth -gt $MaxDepth) {
                $truncation.truncated = $true
                if ($Depth -gt $MaxDepth) { $truncation.maxDepthReached = $true }
                # Marks where the walk stopped, so the agent can read that parent's subtree by index.
                $lines.Add(("`t" * $Depth) + "... $($Children.Count - $i) more not shown (snapshot limit)")
                return
            }
            Visit-VshuNode $Children.Item($i) $Depth
        }
    }

    function Visit-VshuNode($Node, [int]$Depth) {
        $identity = try { (@($Node.GetRuntimeId()) -join ".") } catch { [Guid]::NewGuid().ToString() }
        if (-not $seen.Add($identity)) { return }

        $record = New-VshuElementRecord $Node $nextIndex.Value $WindowFrame
        $children = @()
        try {
            $children = @($Node.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition))
        } catch {}
        $meaningfulActions = @(Get-VshuMeaningfulActions $record.actions)
        $title = if ([string]::IsNullOrWhiteSpace($record.name)) { $record.automationId } else { $record.name }
        $role = if ([string]::IsNullOrWhiteSpace($record.localizedControlType)) { $record.controlType } else { $record.localizedControlType }
        $roleKey = $role.ToLowerInvariant()
        $genericSummary = $null
        if (($roleKey -in @("pane", "group", "custom", "unknown")) -and [string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($record.value)) {
            $snippets = @(Get-VshuTextSnippets $Node 8 4)
            if ($snippets.Count -ge 2 -and (Test-VshuPlainTextSubtree $Node)) {
                $genericSummary = ($snippets -join " ")
            }
        }
        if (($roleKey -in @("pane", "group", "custom", "unknown")) -and [string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($record.value) -and $meaningfulActions.Count -eq 0 -and $null -eq $genericSummary -and $children.Count -le 1) {
            Visit-VshuChildren $children $Depth
            return
        }

        $records.Add($record)
        $nextIndex.Value++

        $traits = if ($record.isDisabled) { " (disabled)" } else { "" }
        $line = "$($record.index) $role$traits $(Format-VshuSnapshotText $title)".TrimEnd()
        $line += Format-VshuValueSegment $roleKey $title $record.value
        if (-not [string]::IsNullOrWhiteSpace($genericSummary) -and $genericSummary -ne $title) {
            $line += ", Text: " + (Format-VshuSnapshotText $genericSummary)
        } elseif ($roleKey -in @("row", "data item", "list item")) {
            $rowSummary = @((Get-VshuTextSnippets $Node 6 3)) -join " "
            if (-not [string]::IsNullOrWhiteSpace($rowSummary) -and $rowSummary -ne $title) {
                $line += ", Text: " + (Format-VshuSnapshotText $rowSummary)
            }
        }
        if ($meaningfulActions.Count -gt 0) {
            $line += ", Secondary Actions: " + ($meaningfulActions -join ", ")
        }
        $lines.Add(("`t" * $Depth) + $line)

        if (-not [string]::IsNullOrWhiteSpace($genericSummary) -or (Test-VshuSuppressChildren $roleKey $title $record.value $genericSummary)) { return }
        $childLineStart = $lines.Count
        Visit-VshuChildren $children ($Depth + 1)
        if ($CompactBrowserTabs) {
            Compress-VshuRenderedBrowserTabs $records $lines $childLineStart ($Depth + 1)
        }
    }

    Visit-VshuNode $RootElement 0
    [pscustomobject]@{ elements = @($records.ToArray()); lines = @($lines.ToArray()); truncation = $truncation }
}

function Compress-VshuRenderedBrowserTabs($Records, $Lines, [int]$StartLine, [int]$Depth) {
    $tabLineIndexes = New-Object System.Collections.Generic.List[int]
    for ($lineIndex = $StartLine; $lineIndex -lt $Lines.Count; $lineIndex++) {
        if (Test-VshuDirectRenderedBrowserTabLine ([string]$Lines[$lineIndex]) $Depth) {
            $tabLineIndexes.Add($lineIndex)
        }
    }
    if ($tabLineIndexes.Count -lt 10) { return }

    $recordsByIndex = @{}
    foreach ($record in @($Records.ToArray())) {
        $recordsByIndex[[int]$record.index] = $record
    }
    $activeLineIndexes = New-Object System.Collections.Generic.HashSet[int]
    foreach ($lineIndex in $tabLineIndexes) {
        if (Test-VshuActiveRenderedBrowserTabLine ([string]$Lines[$lineIndex]) $Depth $recordsByIndex) {
            [void]$activeLineIndexes.Add($lineIndex)
        }
    }
    if ($activeLineIndexes.Count -eq 0) { return }

    $omittedRecordIndexes = New-Object System.Collections.Generic.HashSet[int]
    $omittedCount = 0
    $insertionIndex = $tabLineIndexes[0]
    for ($i = $tabLineIndexes.Count - 1; $i -ge 0; $i--) {
        $lineIndex = $tabLineIndexes[$i]
        if ($activeLineIndexes.Contains($lineIndex)) { continue }
        $recordIndex = Get-VshuRenderedElementIndex ([string]$Lines[$lineIndex]) $Depth
        if ($null -ne $recordIndex) {
            [void]$omittedRecordIndexes.Add([int]$recordIndex)
        }
        $Lines.RemoveAt($lineIndex)
        $omittedCount++
    }
    if ($omittedCount -le 0) { return }
    for ($recordIndex = $Records.Count - 1; $recordIndex -ge 0; $recordIndex--) {
        if ($omittedRecordIndexes.Contains([int]$Records[$recordIndex].index)) {
            $Records.RemoveAt($recordIndex)
        }
    }
    $Lines.Insert($insertionIndex, (("`t" * $Depth) + "... $omittedCount inactive browser tabs omitted"))
}

function Test-VshuDirectRenderedBrowserTabLine([string]$Line, [int]$Depth) {
    $indent = "`t" * $Depth
    if (-not $Line.StartsWith($indent)) { return $false }
    $text = $Line.Substring($indent.Length)
    if ($text.StartsWith("`t")) { return $false }
    $text -match "^\d+ (page tab|tab item|tab)($|[ \(,])"
}

function Test-VshuActiveRenderedBrowserTabLine([string]$Line, [int]$Depth, $RecordsByIndex) {
    if ($Line.Contains("(selected")) { return $true }
    $recordIndex = Get-VshuRenderedElementIndex $Line $Depth
    if ($null -eq $recordIndex -or -not $RecordsByIndex.ContainsKey([int]$recordIndex)) { return $false }
    $record = $RecordsByIndex[[int]$recordIndex]
    [bool]$record.isSelected -or (Format-VshuSnapshotText $record.value) -eq "1"
}

function Get-VshuRenderedElementIndex([string]$Line, [int]$Depth) {
    $text = $Line.Substring(("`t" * $Depth).Length)
    if ($text -match "^(\d+)") { return [int]$Matches[1] }
    $null
}

function ConvertTo-VshuImageBytes([System.Drawing.Image]$Image, [string]$Format) {
    $stream = $null
    $parameters = $null
    try {
        $stream = New-Object System.IO.MemoryStream
        if ($Format -eq "jpeg") {
            $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
                Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid } |
                Select-Object -First 1
            $parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
            $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$JpegScreenshotQuality)
            $Image.Save($stream, $codec, $parameters)
        } else {
            $Image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        return ,$stream.ToArray()
    } finally {
        if ($null -ne $parameters) { $parameters.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

# The size and format the caller asked for; a value the RPC layer would refuse is ignored.
function Get-VshuScreenshotRequest($Operation) {
    $request = [pscustomobject]@{ format = "png"; maxScale = $null; maxEdge = $null }
    if ($Operation.screenshotFormat -eq "jpeg") { $request.format = "jpeg" }
    foreach ($pair in @(@("screenshotScale", "maxScale"), @("screenshotMaxEdge", "maxEdge"))) {
        $value = $Operation.($pair[0])
        if (($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]) -and [double]$value -gt 0 -and -not [double]::IsInfinity([double]$value)) {
            $request.($pair[1]) = [double]$value
        }
    }
    $request
}

function New-VshuScreenshotPayload([byte[]]$Bytes, [string]$Format, [int]$Width, [int]$Height, [double]$Scale) {
    [pscustomobject]@{
        base64 = [Convert]::ToBase64String($Bytes)
        format = $Format
        width = $Width
        height = $Height
        scale = $Scale
    }
}

function Resize-VshuBitmap([System.Drawing.Bitmap]$Source, [int]$Width, [int]$Height) {
    $resized = $null
    $graphics = $null
    try {
        $resized = New-Object System.Drawing.Bitmap $Width, $Height
        $graphics = [System.Drawing.Graphics]::FromImage($resized)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
        $graphics.DrawImage($Source, 0, 0, $Width, $Height)
        $result = $resized
        $resized = $null
        return $result
    } finally {
        if ($null -ne $graphics) { $graphics.Dispose() }
        if ($null -ne $resized) { $resized.Dispose() }
    }
}

function Get-VshuBoundedScreenshotPayload([System.Drawing.Bitmap]$Bitmap, $Request) {
    $originalWidth = [int][Math]::Max(1, $Bitmap.Width)
    $originalHeight = [int][Math]::Max(1, $Bitmap.Height)
    $longEdge = [double][Math]::Max($originalWidth, $originalHeight)
    # Captures here are one pixel per window coordinate, so the scale cap is the resize factor itself.
    $requested = 1.0
    if ($null -ne $Request.maxScale) { $requested = [Math]::Min($requested, $Request.maxScale) }
    if ($null -ne $Request.maxEdge) { $requested = [Math]::Min($requested, $Request.maxEdge / $longEdge) }

    # Why: screenshots cross process boundaries as base64 in JSON; after the requested size, cap noisy
    # large-window payloads to match the macOS provider's memory bounds.
    $scales = New-Object System.Collections.Generic.List[double]
    $scales.Add($requested)
    $scale = [Math]::Min($requested, $MaxScreenshotEdge / $longEdge)
    while ($scale -ge $MinScreenshotScale) {
        $scales.Add($scale)
        $scale *= $ScreenshotScaleStep
    }

    $tried = $null
    foreach ($candidateScale in $scales) {
        # Rounds down, so a requested scale or edge is a ceiling; the epsilon keeps an exact product such as 0.5 x 200 whole.
        $width = [int][Math]::Max(1, [Math]::Floor($originalWidth * $candidateScale + 1e-9))
        $height = [int][Math]::Max(1, [Math]::Floor($originalHeight * $candidateScale + 1e-9))
        if ("${width}x${height}" -eq $tried) { continue }
        $tried = "${width}x${height}"

        $resized = $null
        try {
            $image = $Bitmap
            if ($width -ne $originalWidth -or $height -ne $originalHeight) {
                $resized = Resize-VshuBitmap $Bitmap $width $height
                $image = $resized
            }
            $candidateBytes = ConvertTo-VshuImageBytes $image $Request.format
            if ($candidateBytes.Length -le $MaxScreenshotPngBytes) {
                return New-VshuScreenshotPayload $candidateBytes $Request.format $width $height ($width / [double]$originalWidth)
            }
        } finally {
            if ($null -ne $resized) { $resized.Dispose() }
        }
    }

    [pscustomobject]@{
        error = [pscustomobject]@{
            code = "screenshot_failed"
            message = "screenshot exceeded the computer-use payload cap after downscaling; retry with --no-screenshot or target a smaller window"
        }
    }
}

function Get-VshuScreenshot($ScreenshotRequest, $WindowFrame, [IntPtr]$WindowHandle) {
    if ($null -eq $ScreenshotRequest -or $null -eq $WindowFrame) { return $null }
    $bitmap = $null
    $graphics = $null
    try {
        $width = [int][Math]::Max(1, [Math]::Round($WindowFrame.width))
        $height = [int][Math]::Max(1, [Math]::Round($WindowFrame.height))
        $bitmap = [VshuDesktopWin32]::CaptureWindow($WindowHandle, $width, $height, $WindowResponseTimeoutMilliseconds)
        if ($null -eq $bitmap) {
            # Screen copy shows whatever is on top, so it is only the fallback for windows that render blank.
            $bitmap = New-Object System.Drawing.Bitmap $width, $height
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen([int][Math]::Round($WindowFrame.x), [int][Math]::Round($WindowFrame.y), 0, 0, $bitmap.Size)
        }
        Get-VshuBoundedScreenshotPayload $bitmap $ScreenshotRequest
    } catch {
        $null
    } finally {
        if ($null -ne $graphics) { $graphics.Dispose() }
        if ($null -ne $bitmap) { $bitmap.Dispose() }
    }
}

function New-VshuSnapshot([string]$Query, $ScreenshotRequest, $WindowId = $null, $WindowIndex = $null, [bool]$RestoreWindow = $false, $TreeRoot = $null) {
    $process = Find-VshuProcess $Query
    $handle = Resolve-VshuTargetWindow $process $WindowId $WindowIndex
    # Root first: its hang probe must run before ShowWindow, which blocks on a hung window.
    $root = Get-VshuRootElement $process $handle
    # Why: observation works behind other windows, so a refused raise still returns the snapshot.
    if ($RestoreWindow) { [void](Restore-VshuWindow $handle $root) }
    $windowFrame = Get-VshuWindowFrame $handle $root
    $walkRoot = $root
    if ($null -ne $TreeRoot) {
        $walkRoot = Find-VshuElement $root $TreeRoot
        if ($null -eq $walkRoot) {
            throw "stale element: element $($TreeRoot.index) is gone; run get-app-state again and use a fresh element index"
        }
    }
    $tree = Render-VshuTree $walkRoot $windowFrame (Test-VshuBrowserProcess $process)
    $screenshot = Get-VshuScreenshot $ScreenshotRequest $windowFrame $handle

    [pscustomobject]@{
        snapshotId = [guid]::NewGuid().ToString()
        app = New-VshuAppRecord $process
        windowTitle = [VshuDesktopWin32]::GetWindowTitle($handle)
        windowId = [int64]$handle
        windowBounds = $windowFrame
        screenshotBase64 = if ($null -ne $screenshot) { $screenshot.base64 } else { $null }
        screenshotFormat = if ($null -ne $screenshot) { $screenshot.format } else { $null }
        screenshotWidth = if ($null -ne $screenshot) { $screenshot.width } else { $null }
        screenshotHeight = if ($null -ne $screenshot) { $screenshot.height } else { $null }
        screenshotScale = if ($null -ne $screenshot) { $screenshot.scale } else { $null }
        screenshotError = if ($null -ne $screenshot) { $screenshot.error } else { $null }
        coordinateSpace = "window"
        truncation = $tree.truncation
        treeLines = @($tree.lines)
        focusedSummary = $null
        focusedElementId = $null
        selectedText = $null
        elements = @($tree.elements)
    }
}

function Get-VshuAppList {
    @(Get-VshuWindowProcesses | ForEach-Object {
        New-VshuAppRecord $_
    })
}

function Get-VshuWindowList([string]$Query) {
    $process = Find-VshuProcess $Query
    $handle = Resolve-VshuTargetWindow $process $null $null
    $root = Get-VshuRootElement $process $handle
    $windowFrame = Get-VshuWindowFrame $handle $root
    $x = $null
    $y = $null
    $width = 0
    $height = 0
    if ($null -ne $windowFrame) {
        $x = [int][Math]::Round($windowFrame.x)
        $y = [int][Math]::Round($windowFrame.y)
        $width = [int][Math]::Max(0, [Math]::Round($windowFrame.width))
        $height = [int][Math]::Max(0, [Math]::Round($windowFrame.height))
    }
    $app = New-VshuAppRecord $process
    [pscustomobject]@{
        app = $app
        windows = @([pscustomobject]@{
            index = 0
            app = $app
            id = [int64]$handle
            title = [VshuDesktopWin32]::GetWindowTitle($handle)
            x = $x
            y = $y
            width = $width
            height = $height
            isMinimized = $false
            isOffscreen = $false
            screenIndex = $null
            platform = [pscustomobject]@{ backend = "uia"; nativeWindowHandle = [int64]$handle }
        })
    }
}

function Resolve-VshuLaunchExecutable([string]$Query) {
    $needle = $Query.Trim()
    if ([System.IO.Path]::IsPathRooted($needle)) {
        if (Test-Path -LiteralPath $needle -PathType Leaf) { return $needle }
        throw "appNotFound(`"$Query`")"
    }
    $exe = if ($needle.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) { $needle } else { "$needle.exe" }
    $command = Get-Command -Name ([WildcardPattern]::Escape($exe)) -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) { return [string]$command.Source }
    # Why: Start-Process finds apps such as chrome.exe through App Paths, which PATH lookup misses.
    foreach ($hive in @("HKCU:", "HKLM:")) {
        $entry = Get-ItemProperty -LiteralPath "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction SilentlyContinue
        if ($null -eq $entry -or [string]::IsNullOrWhiteSpace([string]$entry.'(default)')) { continue }
        $path = [Environment]::ExpandEnvironmentVariables(([string]$entry.'(default)').Trim('"'))
        if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
    }
    throw "appNotFound(`"$Query`")"
}

function Wait-VshuLaunchedWindow([int]$ProcessId, [string]$ProcessName, [DateTime]$StartedAt, [int]$TimeoutMilliseconds) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($null -ne $process -and $process.MainWindowHandle -ne 0) { return $process }
        if ($null -eq $process) {
            # Why: stubs such as Windows 11's notepad.exe start the real app under the same name and exit.
            $handoff = Get-VshuWindowProcesses | Where-Object {
                $_.ProcessName -ieq $ProcessName -and $_.StartTime -ge $StartedAt
            } | Select-Object -First 1
            if ($null -ne $handoff) { return $handoff }
        }
        Start-Sleep -Milliseconds 100
    }
    Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
}

function New-VshuLaunchResult($Process, [bool]$Launched) {
    $owner = [uint32]0
    [void][VshuDesktopWin32]::GetWindowThreadProcessId([VshuDesktopWin32]::GetForegroundWindow(), [ref]$owner)
    # Why: measured, not taken from the request; an app may raise itself however it was started.
    $delivery = if ($owner -eq $Process.Id) { "foreground" } else { "background" }
    [pscustomobject]@{ ok = $true; app = New-VshuAppRecord $Process; launched = $Launched; delivery = $delivery }
}

function Find-VshuRunningLaunchTarget([string]$ProcessName, [string]$ExecutablePath = "") {
    # Why: starting a running app again usually opens a second window over the user's work; tray-only apps count too.
    $session = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    $running = @(Get-Process -Name ([WildcardPattern]::Escape($ProcessName)) -ErrorAction SilentlyContinue | Where-Object {
        # A resolved executable must be that file, not another copy with the same name.
        $_.SessionId -eq $session -and ([string]::IsNullOrEmpty($ExecutablePath) -or [string]$_.Path -ieq $ExecutablePath)
    }) | Sort-Object { $_.MainWindowHandle -eq 0 } | Select-Object -First 1
    if ($null -ne $running) { Assert-VshuProcessAllowed $running }
    $running
}

function Invoke-VshuLaunchApp($Operation) {
    $query = ([string]$Operation.app).Trim()
    if ([string]::IsNullOrWhiteSpace($query)) { throw 'appNotFound("")' }
    # A bare name means any running copy; a path means that file, checked once it resolves.
    if (-not [System.IO.Path]::IsPathRooted($query)) {
        $queryName = if ($query.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) { $query.Substring(0, $query.Length - 4) } else { $query }
        $running = Find-VshuRunningLaunchTarget $queryName
        if ($null -ne $running) { return New-VshuLaunchResult $running $false }
    }

    $executable = [System.IO.Path]::GetFullPath((Resolve-VshuLaunchExecutable $query))
    # Why: an App Paths alias can name a differently named executable.
    $running = Find-VshuRunningLaunchTarget ([System.IO.Path]::GetFileNameWithoutExtension($executable)) $executable
    if ($null -ne $running) { return New-VshuLaunchResult $running $false }
    $name = [System.IO.Path]::GetFileNameWithoutExtension($executable).ToLowerInvariant().Replace(" ", "")
    foreach ($fragment in $BlockedAppFragments) {
        if ($name.Contains($fragment.Replace(" ", ""))) { throw "appBlocked(`"$name`")" }
    }
    $activate = [bool]$Operation.activate
    # Why: Vshu runs this script with ELECTRON_RUN_AS_NODE=1, which would start an Electron app as bare Node.
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $startedAt = (Get-Date).AddSeconds(-1)
    try {
        $processId = if ($activate) {
            (Start-Process -FilePath $executable -PassThru).Id
        } else {
            [VshuDesktopWin32]::LaunchWithoutForeground($executable, [System.IO.Path]::GetDirectoryName($executable))
        }
    } catch {
        throw "app_launch_failed: could not launch '$query': $($_.Exception.Message)"
    }
    $process = Wait-VshuLaunchedWindow $processId ([System.IO.Path]::GetFileNameWithoutExtension($executable)) $startedAt 10000
    if ($null -eq $process) {
        throw "app_launch_failed: the process started for '$query' exited; if it handed off to another process, find that one with list-apps"
    }
    $result = New-VshuLaunchResult $process $true
    # Why: an app that still took the foreground keeps the keyboard; burying it would hide where typing goes.
    if (-not $activate -and $result.delivery -eq "background" -and $process.MainWindowHandle -ne 0) {
        [void][VshuDesktopWin32]::SendWindowToBack([IntPtr]$process.MainWindowHandle)
    }
    $result
}

function Get-VshuHandshake {
    [pscustomobject]@{
        platform = "win32"
        provider = "vshu-computer-use-windows"
        providerVersion = "1.0.0"
        protocolVersion = 1
        supports = [pscustomobject]@{
            apps = [pscustomobject]@{ list = $true; bundleIds = $false; pids = $true; launch = $true }
            windows = [pscustomobject]@{ list = $true; targetById = $true; targetByIndex = $true; focus = $false; moveResize = $false }
            observation = [pscustomobject]@{ screenshot = $true; annotatedScreenshot = $false; elementFrames = $true; ocr = $false; disabledState = $true }
            actions = [pscustomobject]@{
                click = $true
                typeText = $true
                typeTextElement = $true
                pressKey = $true
                hotkey = $true
                pasteText = $true
                scroll = $true
                drag = $true
                setValue = $true
                performAction = $true
            }
            surfaces = [pscustomobject]@{ menus = $false; dialogs = $false; dock = $false; menubar = $false }
            # Why: only UI Automation actions reach a background window; real mouse and key input is refused without restoreWindow.
            input = [pscustomobject]@{ background = $false }
        }
    }
}

function Test-VshuSameRuntimeId($Left, $Right) {
    if ($null -eq $Left -or $null -eq $Right -or $Left.Count -ne $Right.Count) { return $false }
    for ($i = 0; $i -lt $Left.Count; $i++) {
        if ([int]$Left[$i] -ne [int]$Right[$i]) { return $false }
    }
    $true
}

function Find-VshuElement($RootElement, $Record) {
    if ($null -eq $Record) { return $null }
    if ($Record.index -eq 0) { return $RootElement }

    try {
        $descendants = $RootElement.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
        for ($i = 0; $i -lt $descendants.Count; $i++) {
            $candidate = $descendants.Item($i)
            if (Test-VshuSameRuntimeId @($candidate.GetRuntimeId()) @($Record.runtimeId)) {
                return $candidate
            }
        }
    } catch {}
    $null
}

# Why: UI Automation's Invoke and Toggle focus a WinForms button first, which activates its background window;
# BM_CLICK runs the button's own click (and check box or radio state) with no focus change.
function Invoke-VshuNativeButtonClick($Element, $Process) {
    if ($null -eq $Process) { return $false }
    # Why: measured on WinForms, whose buttons click on BM_CLICK directly; a user32 button simulates the mouse and
    # sets focus, which can fail in an inactive dialog, so those keep the UI Automation pattern.
    if ((Get-VshuProperty $Element "ClassName") -notmatch "^WindowsForms\d+\.BUTTON\.") { return $false }
    $button = Get-VshuNativeControl $Element $Process "Button"
    if ($null -eq $button) { return $false }
    # Why: a group box shares the Button class but presses nothing; real buttons offer one of these patterns.
    $patterns = @(try { $Element.GetSupportedPatterns() } catch { @() })
    $pressable = @([Windows.Automation.InvokePattern]::Pattern, [Windows.Automation.TogglePattern]::Pattern, [Windows.Automation.SelectionItemPattern]::Pattern)
    if (@($patterns | Where-Object { $pressable -contains $_ }).Count -eq 0) { return $false }
    # A click that opens a modal dialog doesn't return until the dialog closes, so an unanswered BM_CLICK still counts as sent.
    [void][VshuDesktopWin32]::SendControlMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    $true
}

# False only when the element offers none of these patterns; a pattern that fails is an error, never a cue for a real click.
function Invoke-VshuPrimaryAction($Element, $Index, $Process) {
    if (Invoke-VshuNativeButtonClick $Element $Process) { return $true }
    foreach ($pattern in @(
        [Windows.Automation.InvokePattern]::Pattern,
        [Windows.Automation.SelectionItemPattern]::Pattern,
        [Windows.Automation.TogglePattern]::Pattern
    )) {
        $instance = $null
        if (-not $Element.TryGetCurrentPattern($pattern, [ref]$instance)) { continue }
        $name = ([string]$pattern.ProgrammaticName) -replace "PatternIdentifiers\.Pattern$", ""
        try {
            if ($pattern -eq [Windows.Automation.InvokePattern]::Pattern) { $instance.Invoke() }
            elseif ($pattern -eq [Windows.Automation.SelectionItemPattern]::Pattern) { $instance.Select() }
            else { $instance.Toggle() }
            return $true
        } catch {
            # Why: PowerShell wraps exceptions from method calls, so match the provider's own exception.
            $failure = $_.Exception.GetBaseException()
            if ($failure -is [Windows.Automation.ElementNotEnabledException]) {
                throw "element_not_enabled: element $Index is disabled, so no input was sent; do what enables it first, then run get-app-state and retry once its line no longer lists disabled"
            }
            throw "UI Automation $name failed on element ${Index}: $($failure.Message); no mouse click was sent in its place. Run get-app-state to check whether it took effect before retrying"
        }
    }
    $false
}

function Invoke-VshuNamedAction($Element, [string]$Action) {
    $wanted = ""
    # Why: accept the rendered name ("ScrollToVisible") and macOS's spaced form ("scroll to visible").
    if ($null -ne $Action) { $wanted = ($Action -replace "\s+", "").ToLowerInvariant() }
    switch ($wanted) {
        "invoke" {
            $pattern = $Element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
            $pattern.Invoke()
            return $true
        }
        "select" {
            $pattern = $Element.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
            $pattern.Select()
            return $true
        }
        "toggle" {
            $pattern = $Element.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)
            $pattern.Toggle()
            return $true
        }
        "expand" {
            $pattern = $Element.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern)
            $pattern.Expand()
            return $true
        }
        "collapse" {
            $pattern = $Element.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern)
            $pattern.Collapse()
            return $true
        }
        "scrolltovisible" {
            $pattern = $Element.GetCurrentPattern([Windows.Automation.ScrollItemPattern]::Pattern)
            $pattern.ScrollIntoView()
            return $true
        }
        default {
            return $false
        }
    }
}

function Test-VshuRangeValueMatches([string]$Actual, [double]$Expected) {
    # Why: allow float32 rounding (0.1 reads back 0.100000001), but cap it so a snapped neighbour never verifies at any size.
    $actualNumber = 0.0
    [double]::TryParse($Actual, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$actualNumber) -and
        [Math]::Abs($actualNumber - $Expected) -le [Math]::Min(1e-6 * [Math]::Max(1.0, [Math]::Abs($Expected)), 1e-3)
}

function Set-VshuNativeComboValue($Element, $Process, [string]$Value) {
    $combo = Get-VshuNativeControl $Element $Process "ComboBox"
    if ($null -eq $combo) { return $null }
    # Why: an owner-drawn combo without CBS_HASSTRINGS keeps item data, not names, so its items can't be found by name.
    $style = [VshuDesktopWin32]::GetWindowLong($combo, -16)
    if (($style -band 0x0030) -ne 0 -and ($style -band 0x0200) -eq 0) { return $null }
    $count = [VshuDesktopWin32]::SendControlMessage($combo, 0x0146, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($null -eq $count -or $count -le 0) { return $null }
    # Why: CB_FINDSTRINGEXACT ignores case and wraps, so walk its hits once and keep those whose text matches exactly.
    $exact = @()
    $first = [VshuDesktopWin32]::FindControlString($combo, 0x0158, -1, $Value)
    $hit = $first
    for ($step = 0; $null -ne $hit -and $hit -ge 0 -and $step -lt $count; $step++) {
        $text = [VshuDesktopWin32]::GetControlItemText($combo, 0x0149, 0x0148, [int]$hit)
        if ($text -ceq $Value) { $exact += [int]$hit }
        $hit = [VshuDesktopWin32]::FindControlString($combo, 0x0158, [int]$hit, $Value)
        # Why: a search or read the combo didn't answer could hide a second option with the same name.
        if ($null -eq $text -or $null -eq $hit) {
            throw "window_not_responding: the combo box did not answer its option search in time; nothing was selected"
        }
        if ($hit -eq $first) { break }
    }
    if ($exact.Count -eq 0) { return $null }
    if ($exact.Count -gt 1) { throw "element value is not settable by name: more than one option is named '$Value'" }
    # CB_SETCURSEL changes the selection without opening the list; CBN_SELCHANGE runs the app's own change handler.
    Assert-VshuWindowOwner $combo ([int]$Process.Id)
    if ($null -eq [VshuDesktopWin32]::SendControlMessage($combo, 0x014E, [IntPtr]$exact[0], [IntPtr]::Zero)) {
        throw "window_not_responding: the combo box did not answer in time; the selection may still change, so run get-app-state before retrying"
    }
    $parent = [VshuDesktopWin32]::GetParent($combo)
    if ($parent -ne [IntPtr]::Zero) {
        Assert-VshuWindowOwner $parent ([int]$Process.Id)
        $command = [IntPtr]((1 -shl 16) -bor ([VshuDesktopWin32]::GetDlgCtrlID($combo) -band 0xFFFF))
        [void][VshuDesktopWin32]::SendControlMessage($parent, 0x0111, $command, $combo)
    }
    # Why: the change handler ran inside the send above, so the selection now is the one the app kept.
    $selected = [VshuDesktopWin32]::SendControlMessage($combo, 0x0147, [IntPtr]::Zero, [IntPtr]::Zero)
    # Why: a handler that clears the selection leaves CB_ERR (-1), which contradicts the write rather than hiding it.
    $actual = if ($null -eq $selected) { $null } elseif ($selected -lt 0) { "" } else { [VshuDesktopWin32]::GetControlItemText($combo, 0x0149, 0x0148, [int]$selected) }
    $verification = if ($actual -ceq $Value) {
        [pscustomobject]@{ state = "verified"; property = "value" }
    } elseif ($null -eq $actual) {
        [pscustomobject]@{ state = "unverified"; reason = "readback_unsupported" }
    } else {
        [pscustomobject]@{ state = "unverified"; reason = "value_mismatch"; actualPreview = $actual }
    }
    [pscustomobject]@{ verification = $verification }
}

function Set-VshuNativeEditValue($Element, $Process, [int]$Index, [string]$Value) {
    $edit = Get-VshuNativeEdit $Element $Process
    if ($null -eq $edit) { return $null }
    # Why: UI Automation's ValuePattern focuses the field first, which activates its background window; selecting
    # everything and replacing it runs the edit's own change notification, which WM_SETTEXT skips for multiline edits.
    Assert-VshuWindowOwner $edit.handle $edit.processId
    if ($null -eq [VshuDesktopWin32]::SendControlMessage($edit.handle, 0x00B1, [IntPtr]::Zero, [IntPtr](-1))) {
        throw "window_not_responding: the text field did not answer in time; nothing was written"
    }
    $action = Invoke-VshuEditTextInsertion $edit $Index $Value -ReplaceAll
    $verification = if ($action.verification.state -eq "verified") {
        [pscustomobject]@{ state = "verified"; property = "value" }
    } elseif ($action.verification.reason -eq "text_mismatch") {
        [pscustomobject]@{ state = "unverified"; reason = "value_mismatch" }
    } else {
        $action.verification
    }
    [pscustomobject]@{ verification = $verification }
}

function Set-VshuElementValue($Element, $Process, [int]$Index, [string]$Value) {
    if ($null -ne $Process) {
        # Why: these write native controls without focusing them; a disabled one is locked against the user, so it is refused.
        $native = (Test-VshuEditClass (Get-VshuProperty $Element "ClassName")) -or (Test-VshuNativeClass (Get-VshuProperty $Element "ClassName") "ComboBox")
        if ($native -and (Test-VshuElementDisabled $Element)) {
            throw "element_not_enabled: element $Index is disabled, so no input was sent; do what enables it first, then run get-app-state and retry once its line no longer lists disabled"
        }
        $combo = Set-VshuNativeComboValue $Element $Process $Value
        if ($null -ne $combo) { return $combo }
        $edit = Set-VshuNativeEditValue $Element $Process $Index $Value
        if ($null -ne $edit) { return $edit }
    }
    try {
        $pattern = $Element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
        if (-not $pattern.Current.IsReadOnly) {
            $pattern.SetValue($Value)
            return [pscustomobject]@{ verification = $null }
        }
    } catch {}
    if (-not (Test-VshuRangeValueWritable $Element)) { return $null }
    $range = $Element.GetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern)
    $culture = [Globalization.CultureInfo]::InvariantCulture
    $number = 0.0
    if (-not [double]::TryParse($Value, [Globalization.NumberStyles]::Float, $culture, [ref]$number) -or [double]::IsNaN($number)) {
        throw "value must be a number for this range control"
    }
    $minimum = [double]$range.Current.Minimum
    $maximum = [double]$range.Current.Maximum
    if ($number -lt $minimum -or $number -gt $maximum) {
        throw "value $Value is outside this range control's $($minimum.ToString($culture))..$($maximum.ToString($culture))"
    }
    $range.SetValue($number)
    # Why: Chromium applies the write asynchronously, so poll briefly like macOS's settled readback.
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        $actual = Get-VshuRangeValueText $Element
        $matched = Test-VshuRangeValueMatches $actual $number
        if ($matched -or $stopwatch.ElapsedMilliseconds -ge 500) { break }
        Start-Sleep -Milliseconds 25
    }
    $verification = if ($matched) {
        [pscustomobject]@{ state = "verified"; property = "value"; expected = $Value; actualPreview = $actual }
    } elseif ([string]::IsNullOrEmpty($actual)) {
        # Why: a failed read is not evidence the write failed; only a read-back number can contradict it.
        [pscustomobject]@{ state = "unverified"; reason = "readback_unsupported"; expected = $Value }
    } else {
        [pscustomobject]@{ state = "unverified"; reason = "value_mismatch"; expected = $Value; actualPreview = $actual }
    }
    [pscustomobject]@{ verification = $verification }
}

function Get-VshuScrollPattern($Element, $RootElement, [bool]$Vertical) {
    $rootId = Get-VshuRuntimeId $RootElement
    $current = $Element
    # Why: an item's ScrollPattern lives on its list or viewport, the same container a wheel at its center would scroll.
    while ($null -ne $current) {
        try {
            $pattern = $current.GetCurrentPattern([Windows.Automation.ScrollPattern]::Pattern)
            $scrollable = if ($Vertical) { $pattern.Current.VerticallyScrollable } else { $pattern.Current.HorizontallyScrollable }
            if ($scrollable) { return $pattern }
        } catch {}
        if (Test-VshuSameRuntimeId (Get-VshuRuntimeId $current) $rootId) { break }
        $current = try { [Windows.Automation.TreeWalker]::RawViewWalker.GetParent($current) } catch { $null }
    }
    $null
}

function Test-VshuElementWithin($Element, $RootElement) {
    $rootId = Get-VshuRuntimeId $RootElement
    $current = $Element
    for ($depth = 0; $null -ne $current -and $depth -le $MaxDepth; $depth++) {
        if (Test-VshuSameRuntimeId (Get-VshuRuntimeId $current) $rootId) { return $true }
        $current = try { [Windows.Automation.TreeWalker]::RawViewWalker.GetParent($current) } catch { $null }
    }
    $false
}

# The element a wheel at this screen point would scroll: what is drawn there, else (when another window covers it)
# the innermost on-screen scroll container under it.
function Find-VshuScrollContainerAt($RootElement, [double]$ScreenX, [double]$ScreenY, [bool]$Vertical) {
    try {
        $hit = [Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point $ScreenX, $ScreenY))
        if (Test-VshuElementWithin $hit $RootElement) { return $hit }
    } catch {}
    $candidates = @($RootElement)
    try {
        $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty, $true)
        $found = $RootElement.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
        for ($i = 0; $i -lt $found.Count; $i++) { $candidates += $found.Item($i) }
    } catch {}
    $best = $null
    $bestArea = [double]::PositiveInfinity
    foreach ($candidate in $candidates) {
        try {
            if ($candidate.Current.IsOffscreen) { continue }
            $rect = $candidate.Current.BoundingRectangle
            if ($rect.IsEmpty -or $ScreenX -lt $rect.X -or $ScreenY -lt $rect.Y -or $ScreenX -ge $rect.X + $rect.Width -or $ScreenY -ge $rect.Y + $rect.Height) { continue }
            $pattern = $candidate.GetCurrentPattern([Windows.Automation.ScrollPattern]::Pattern)
            $scrollable = if ($Vertical) { $pattern.Current.VerticallyScrollable } else { $pattern.Current.HorizontallyScrollable }
            $area = $rect.Width * $rect.Height
            # Why: FindAll lists ancestors first, so a tie goes to the nested viewport.
            if ($scrollable -and $area -le $bestArea) { $best = $candidate; $bestArea = $area }
        } catch {}
    }
    $best
}

function Get-VshuScrollPercent($Pattern, [bool]$Vertical) {
    try {
        if ($Vertical) { return [double]$Pattern.Current.VerticalScrollPercent }
        [double]$Pattern.Current.HorizontalScrollPercent
    } catch {
        $null
    }
}

function Get-VshuScrollViewSize($Pattern, [bool]$Vertical) {
    try {
        if ($Vertical) { return [double]$Pattern.Current.VerticalViewSize }
        [double]$Pattern.Current.HorizontalViewSize
    } catch {
        $null
    }
}

function Wait-VshuScrollPercentChange($Pattern, [bool]$Vertical, $Before) {
    # Why: WPF and Chromium move the viewport after the call returns, so poll briefly for the new position.
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        $after = Get-VshuScrollPercent $Pattern $Vertical
        if ($after -ne $Before -or $stopwatch.ElapsedMilliseconds -ge 500) { return $after }
        Start-Sleep -Milliseconds 25
    }
}

# Moves a fraction of a page by scroll percentage, where one page is the visible share of the content.
function Invoke-VshuScrollPercent($Pattern, [bool]$Vertical, [bool]$Forward, [double]$Pages, [double]$Before) {
    $viewSize = Get-VshuScrollViewSize $Pattern $Vertical
    if ($null -eq $viewSize -or $viewSize -le 0 -or $viewSize -ge 100) { return $false }
    # Why: scroll percent spans the hidden part only, so one view is viewSize / (100 - viewSize) of that range.
    $step = $Pages * 100 * $viewSize / (100 - $viewSize)
    $target = [Math]::Min(100.0, [Math]::Max(0.0, $(if ($Forward) { $Before + $step } else { $Before - $step })))
    if ($target -eq $Before) { return $true }
    $unchanged = [Windows.Automation.ScrollPattern]::NoScroll
    try {
        if ($Vertical) { $Pattern.SetScrollPercent($unchanged, $target) } else { $Pattern.SetScrollPercent($target, $unchanged) }
    } catch {
        return $false
    }
    # Why: the target differs from the start, so an unmoved position means the provider ignored the write.
    $after = Wait-VshuScrollPercentChange $Pattern $Vertical $Before
    $null -ne $after -and $after -ne $Before
}

# Why: ScrollPattern on a list box focuses it first, which activates its background window; LB_SETTOPINDEX pages the
# list itself. A page is the rows the list shows.
function Invoke-VshuNativeListScroll($Element, $RootElement, $Process, [string]$Direction, [double]$Pages) {
    if ($null -eq $Process -or $Direction -notin @("up", "down")) { return $false }
    $rootId = Get-VshuRuntimeId $RootElement
    $current = $Element
    $list = $null
    # Why: an item scrolls with its list box, the window a wheel at its center would scroll.
    while ($null -ne $current -and $null -eq $list) {
        $list = Get-VshuNativeControl $current $Process "ListBox"
        if (Test-VshuSameRuntimeId (Get-VshuRuntimeId $current) $rootId) { break }
        $current = try { [Windows.Automation.TreeWalker]::RawViewWalker.GetParent($current) } catch { $null }
    }
    if ($null -eq $list) { return $false }
    # Why: rows of an LBS_OWNERDRAWVARIABLE list differ in height, so a page can't be counted in rows, and an
    # LBS_MULTICOLUMN list pages sideways.
    if (([VshuDesktopWin32]::GetWindowLong($list, -16) -band 0x0220) -ne 0) { return $false }
    $top = [VshuDesktopWin32]::SendControlMessage($list, 0x018E, [IntPtr]::Zero, [IntPtr]::Zero)
    $count = [VshuDesktopWin32]::SendControlMessage($list, 0x018B, [IntPtr]::Zero, [IntPtr]::Zero)
    $itemHeight = [VshuDesktopWin32]::SendControlMessage($list, 0x01A1, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($null -eq $top -or $null -eq $count -or $null -eq $itemHeight -or $itemHeight -le 0 -or $count -le 0) { return $false }
    $rows = [Math]::Max(1, [Math]::Floor([VshuDesktopWin32]::GetClientHeight($list) / $itemHeight))
    $step = [int][Math]::Max(1, [Math]::Round($rows * $Pages))
    $target = if ($Direction -eq "down") { $top + $step } else { $top - $step }
    # Why: a list that shows every row leaves the scroll to an enclosing ScrollPattern.
    if ($count -le $rows) { return $false }
    $target = [Math]::Max(0, [Math]::Min($count - $rows, $target))
    # Why: at that end already there is nothing left to move, as ScrollPattern reports at the end of its content.
    if ($target -eq $top) { return $true }
    if ($null -eq [VshuDesktopWin32]::SendControlMessage($list, 0x0197, [IntPtr][int]$target, [IntPtr]::Zero)) {
        throw "window_not_responding: the list did not answer in time; it may still scroll, so run get-app-state before retrying"
    }
    $true
}

function Invoke-VshuScrollPattern($Element, $RootElement, $Process, [string]$Direction, [double]$Pages) {
    if ($null -eq $Element) { return $false }
    if (Invoke-VshuNativeListScroll $Element $RootElement $Process $Direction $Pages) { return $true }
    $vertical = $Direction -in @("up", "down")
    $forward = $Direction -in @("down", "right")
    $pattern = Get-VshuScrollPattern $Element $RootElement $vertical
    if ($null -eq $pattern) { return $false }
    # Why: without a readable position nothing can tell the end of the content from a refused scroll.
    $before = Get-VshuScrollPercent $pattern $vertical
    if ($null -eq $before -or $before -lt 0) { return $false }
    if ($Pages -ne [Math]::Floor($Pages)) { return Invoke-VshuScrollPercent $pattern $vertical $forward $Pages $before }
    $amount = if ($forward) { [Windows.Automation.ScrollAmount]::LargeIncrement } else { [Windows.Automation.ScrollAmount]::LargeDecrement }
    $none = [Windows.Automation.ScrollAmount]::NoAmount
    for ($page = 0; $page -lt $Pages; $page++) {
        try {
            if ($vertical) { $pattern.Scroll($none, $amount) } else { $pattern.Scroll($amount, $none) }
        } catch {
            # Why: a refusal before any page moved means ScrollPattern can't do it; after that it is the end of the content.
            return $page -gt 0
        }
        $after = Wait-VshuScrollPercentChange $pattern $vertical $before
        if ($null -eq $after -or $after -eq $before) {
            # Why: a first page that doesn't move away from the end means the provider ignored it; later ones reached the end.
            $atEnd = if ($forward) { $before -ge 99.99 } else { $before -le 0.01 }
            if ($page -eq 0 -and -not $atEnd) { return $false }
            break
        }
        $before = $after
    }
    $true
}

function Get-VshuRequiredNumber($Value, [string]$Name) {
    if ($null -eq $Value) { throw "$Name is required" }
    $number = [double]$Value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
        throw "$Name must be a finite number"
    }
    $number
}

function Get-VshuPositiveInteger($Value, [string]$Name) {
    if ($null -eq $Value) { $Value = 1 }
    $number = [int]$Value
    if ($number -le 0) { throw "$Name must be a positive integer" }
    $number
}

function Get-VshuPositiveNumber($Value, [string]$Name) {
    if ($null -eq $Value) { $Value = 1 }
    $number = Get-VshuRequiredNumber $Value $Name
    if ($number -le 0) { throw "$Name must be a positive number" }
    $number
}

function Get-VshuRequiredString($Value, [string]$Name) {
    if ($null -eq $Value) { throw "$Name is required" }
    $text = [string]$Value
    if ($text.Length -eq 0) { throw "$Name is required" }
    $text
}

function Assert-VshuElementFound($Element, $Record) {
    if ($null -ne $Record -and $null -eq $Element) { throw "stale element frame; run get-app-state again and use a fresh element index" }
}

# Screen point for real mouse input: the element's center when the request names one, else window-local x/y.
function Get-VshuPointerPoint($Element, $Record, $X, $Y, [string]$XName, [string]$YName, $WindowFrame) {
    if ($null -ne $Record) {
        $point = Get-VshuElementScreenPoint $Element
        if ($null -eq $point) { throw "stale element frame; run get-app-state again and use a fresh element index" }
        return $point
    }
    @{
        x = [int][Math]::Round($WindowFrame.x + (Get-VshuRequiredNumber $X $XName))
        y = [int][Math]::Round($WindowFrame.y + (Get-VshuRequiredNumber $Y $YName))
    }
}

function Get-VshuElementScreenPoint($Element) {
    if ($null -eq $Element) { return $null }
    try {
        $rect = $Element.Current.BoundingRectangle
        if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
            return @{
                x = [int][Math]::Round($rect.X + ($rect.Width / 2))
                y = [int][Math]::Round($rect.Y + ($rect.Height / 2))
            }
        }
    } catch {}
    $null
}

function Send-VshuMouseClick([int]$ScreenX, [int]$ScreenY, [string]$Button, [int]$Count, [string]$Modifiers) {
    [void][VshuDesktopWin32]::SetCursorPos($ScreenX, $ScreenY)
    $buttonName = if ([string]::IsNullOrWhiteSpace($Button)) { "left" } else { $Button.ToLowerInvariant() }
    switch ($buttonName) {
        "left" { $down = $MouseEvents.LeftDown; $up = $MouseEvents.LeftUp }
        "right" { $down = $MouseEvents.RightDown; $up = $MouseEvents.RightUp }
        "middle" { $down = $MouseEvents.MiddleDown; $up = $MouseEvents.MiddleUp }
        default { throw "unsupported mouse button: $Button" }
    }

    $modifierKeys = @(Get-VshuClickModifierVirtualKeys $Modifiers)
    $clickCount = Get-VshuPositiveInteger $Count "click_count"
    if ($modifierKeys.Count -eq 0) {
        for ($i = 0; $i -lt $clickCount; $i++) {
            [VshuDesktopWin32]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 35
            [VshuDesktopWin32]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
        }
        return
    }
    for ($i = 0; $i -lt $clickCount; $i++) {
        [VshuDesktopWin32]::SendModifiedClick(
            [byte[]]$modifierKeys,
            [uint32]$down,
            [uint32]$up
        )
        if ($i + 1 -lt $clickCount) { Start-Sleep -Milliseconds 35 }
    }
}

function Send-VshuDrag($From, $To) {
    $startX = [int]$From.x
    $startY = [int]$From.y
    $endX = [int]$To.x
    $endY = [int]$To.y
    [void][VshuDesktopWin32]::SetCursorPos($startX, $startY)
    [VshuDesktopWin32]::mouse_event($MouseEvents.LeftDown, 0, 0, 0, [UIntPtr]::Zero)
    for ($step = 1; $step -le 12; $step++) {
        $x = [int][Math]::Round($startX + (($endX - $startX) * $step / 12))
        $y = [int][Math]::Round($startY + (($endY - $startY) * $step / 12))
        [void][VshuDesktopWin32]::SetCursorPos($x, $y)
        Start-Sleep -Milliseconds 20
    }
    [VshuDesktopWin32]::mouse_event($MouseEvents.LeftUp, 0, 0, 0, [UIntPtr]::Zero)
}

function Send-VshuText([IntPtr]$WindowHandle, [string]$Text) {
    Assert-VshuStillFocused $WindowHandle
    if (-not [VshuDesktopWin32]::SendUnicodeText($Text)) {
        throw "SendInput did not deliver the text; inspect the field before retrying"
    }
}

function Get-VshuVirtualKey([string]$Key) {
    $normalized = $Key.ToLowerInvariant()
    $map = @{
        "return" = 0x0D; "enter" = 0x0D; "tab" = 0x09; "escape" = 0x1B; "esc" = 0x1B
        "backspace" = 0x08; "delete" = 0x2E; "space" = 0x20; "left" = 0x25
        "up" = 0x26; "right" = 0x27; "down" = 0x28; "home" = 0x24; "end" = 0x23
    }
    if ($map.ContainsKey($normalized)) { return $map[$normalized] }
    if ($normalized.Length -eq 1) { return [int][char]$normalized.ToUpperInvariant()[0] }
    throw "Unsupported key: $Key"
}

function Assert-VshuStillFocused([IntPtr]$WindowHandle) {
    # Why: keys go to whatever is in front, so a user switching windows since the focus check must not receive them.
    if (-not (Test-VshuWindowFocused $WindowHandle)) {
        throw "window_not_focused: the target window lost focus before the keys were sent; nothing was sent"
    }
}

function Send-VshuKey([IntPtr]$WindowHandle, [string]$Key) {
    Assert-VshuStillFocused $WindowHandle
    [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-VshuSendKeysKey $Key))
}

function Get-VshuModifierVirtualKey([string]$Modifier) {
    switch ($Modifier.ToLowerInvariant()) {
        { $_ -in @("ctrl", "control", "cmdorctrl", "commandorcontrol") } { return 0x11 }
        { $_ -in @("shift") } { return 0x10 }
        { $_ -in @("alt", "option") } { return 0x12 }
        { $_ -in @("meta", "super", "win", "cmd", "command") } { return 0x5B }
        default { throw "Unsupported modifier: $Modifier" }
    }
}

function Get-VshuClickModifierVirtualKeys([string]$Modifiers) {
    if ([string]::IsNullOrWhiteSpace($Modifiers)) { return @() }
    $parts = @($Modifiers.Split("+") | ForEach-Object { $_.Trim() })
    $emptyParts = @($parts | Where-Object { [string]::IsNullOrWhiteSpace($_) })
    if ($parts.Count -eq 0 -or $emptyParts.Count -gt 0) {
        throw "Click modifiers require modifier keys only"
    }
    @($parts | ForEach-Object { Get-VshuModifierVirtualKey $_ })
}

function ConvertTo-VshuSendKeysHotkey([string]$KeySpec) {
    $parts = @($KeySpec.Split("+") | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($parts.Count -eq 0) { throw "Unsupported key: $KeySpec" }
    $key = $parts[$parts.Count - 1]
    $prefix = ""
    if ($parts.Count -gt 1) {
        # SendKeys adds Shift for an uppercase letter, turning Ctrl+A into Ctrl+Shift+A.
        if ($key.Length -eq 1) { $key = $key.ToLowerInvariant() }
        foreach ($modifier in $parts[0..($parts.Count - 2)]) {
            $prefix += ConvertTo-VshuSendKeysModifier $modifier
        }
    }
    $prefix + (ConvertTo-VshuSendKeysKey $key)
}

function Send-VshuHotkey([IntPtr]$WindowHandle, [string]$KeySpec) {
    $keys = ConvertTo-VshuSendKeysHotkey $KeySpec
    Assert-VshuStillFocused $WindowHandle
    [System.Windows.Forms.SendKeys]::SendWait($keys)
}

function ConvertTo-VshuSendKeysText([string]$Text) {
    $builder = New-Object System.Text.StringBuilder
    foreach ($character in $Text.ToCharArray()) {
        $value = [string]$character
        if ($value -eq "`r") { continue }
        if ($value -eq "`n") { [void]$builder.Append("{ENTER}"); continue }
        if ("+^%~(){}[]".Contains($value)) {
            [void]$builder.Append("{").Append($value).Append("}")
        } else {
            [void]$builder.Append($value)
        }
    }
    $builder.ToString()
}

function ConvertTo-VshuSendKeysKey([string]$Key) {
    switch ($Key.ToLowerInvariant()) {
        { $_ -in @("return", "enter") } { return "{ENTER}" }
        "tab" { return "{TAB}" }
        { $_ -in @("escape", "esc") } { return "{ESC}" }
        "backspace" { return "{BACKSPACE}" }
        "delete" { return "{DELETE}" }
        "space" { return " " }
        "left" { return "{LEFT}" }
        "up" { return "{UP}" }
        "right" { return "{RIGHT}" }
        "down" { return "{DOWN}" }
        "home" { return "{HOME}" }
        "end" { return "{END}" }
        { $_ -in @("pageup", "page_up") } { return "{PGUP}" }
        { $_ -in @("pagedown", "page_down") } { return "{PGDN}" }
        "insert" { return "{INSERT}" }
        default {
            if ($Key.Length -eq 1) { return (ConvertTo-VshuSendKeysText $Key) }
            throw "Unsupported key: $Key"
        }
    }
}

function ConvertTo-VshuSendKeysModifier([string]$Modifier) {
    switch ($Modifier.ToLowerInvariant()) {
        { $_ -in @("ctrl", "control", "cmdorctrl", "commandorcontrol") } { return "^" }
        "shift" { return "+" }
        { $_ -in @("alt", "option") } { return "%" }
        default { throw "Unsupported modifier: $Modifier" }
    }
}

function Send-VshuPasteText([IntPtr]$WindowHandle, [string]$Text) {
    $previous = $null
    $hadPrevious = $false
    try { $previous = [System.Windows.Forms.Clipboard]::GetDataObject() } catch {}
    $hadPrevious = $null -ne $previous
    try {
        Set-Clipboard -Value $Text
        Send-VshuHotkey $WindowHandle "Ctrl+v"
    } finally {
        if ($hadPrevious) {
            try { [System.Windows.Forms.Clipboard]::SetDataObject($previous, $true) } catch {}
        } else {
            try { [System.Windows.Forms.Clipboard]::Clear() } catch {}
        }
    }
}

function Invoke-VshuOperation($Operation) {
    $screenshotRequest = if ([bool]$Operation.noScreenshot) { $null } else { Get-VshuScreenshotRequest $Operation }
    if ($Operation.tool -eq "handshake") {
        return [pscustomobject]@{ ok = $true; capabilities = Get-VshuHandshake }
    }
    if ($Operation.tool -eq "list_apps") {
        return [pscustomobject]@{ ok = $true; apps = @(Get-VshuAppList) }
    }
    if ($Operation.tool -eq "list_windows") {
        $list = Get-VshuWindowList $Operation.app
        return [pscustomobject]@{ ok = $true; app = $list.app; windows = @($list.windows) }
    }
    if ($Operation.tool -eq "launch_app") {
        return Invoke-VshuLaunchApp $Operation
    }
    if ($Operation.tool -eq "get_app_state") {
        return [pscustomobject]@{ ok = $true; snapshot = New-VshuSnapshot $Operation.app $screenshotRequest $Operation.windowId $Operation.windowIndex ([bool]$Operation.restoreWindow) $Operation.root }
    }

    $process = Find-VshuProcess $Operation.app
    Assert-VshuInputAllowed $process
    $handle = Resolve-VshuTargetWindow $process $Operation.windowId $Operation.windowIndex
    $root = Get-VshuRootElement $process $handle
    $restoreWindow = [bool]$Operation.restoreWindow
    $windowFrame = if ($null -ne $Operation.windowBounds) { $Operation.windowBounds } else { Get-VshuWindowFrame $handle $root }
    $element = Find-VshuElement $root $Operation.element
    $fromElement = Find-VshuElement $root $Operation.fromElement
    $toElement = Find-VshuElement $root $Operation.toElement
    $typesIntoElement = $Operation.tool -eq "type_text" -and $null -ne $Operation.element
    if ($Operation.tool -in @("type_text", "press_key", "hotkey", "paste_text") -and -not $typesIntoElement) {
        $restoreFailure = if ($restoreWindow) { Restore-VshuWindow $handle $root } else { $null }
        Assert-VshuKeyboardFocus $handle $Operation $restoreFailure $process
    }
    $foregroundBefore = [VshuDesktopWin32]::GetForegroundWindow()
    # Why: a stale or frameless target must fail before any refusal or raise; a minimized window has no frames until restored.
    $validatePointsBeforeRaise = -not [VshuDesktopWin32]::IsIconic($handle)
    $action = $null

    switch ($Operation.tool) {
        "click" {
            Assert-VshuElementFound $element $Operation.element
            $clickCount = Get-VshuPositiveInteger $Operation.click_count "click_count"
            $button = if ([string]::IsNullOrWhiteSpace([string]$Operation.mouse_button)) { "left" } else { ([string]$Operation.mouse_button).ToLowerInvariant() }
            if ($button -notin @("left", "right", "middle")) { throw "unsupported mouse button: $($Operation.mouse_button)" }
            [void](Get-VshuClickModifierVirtualKeys $Operation.modifiers)
            if ($null -ne $element -and (Test-VshuElementDisabled $element)) {
                throw "element_not_enabled: element $($Operation.element.index) is disabled, so no input was sent; do what enables it first, then run get-app-state and retry once its line no longer lists disabled"
            }
            $pointerNeed = if (-not [string]::IsNullOrWhiteSpace([string]$Operation.modifiers)) { "a click with modifiers needs the real mouse and keyboard" }
                elseif ($button -eq "right") { "a right-click needs the real mouse" }
                elseif ($button -eq "middle") { "a middle-click needs the real mouse" }
                elseif ($clickCount -gt 1) { "a double or multi-click needs the real mouse" }
                elseif ($null -eq $Operation.element) { "a click by coordinates needs the real mouse" }
                else { $null }
            $alternative = if ($null -eq $Operation.element) { "Click an element by --element-index instead when it lists Invoke, Select or Toggle." } else { "" }
            if ($null -eq $pointerNeed) {
                if (Invoke-VshuPrimaryAction $element $Operation.element.index $process) {
                    $action = [pscustomobject]@{ path = "accessibility"; actionName = "primaryAction"; fallbackReason = $null }
                    break
                }
                $pointerNeed = "element $($Operation.element.index) has no Invoke, Select or Toggle action, so clicking it needs the real mouse"
                $alternative = "For a text field, use set-value instead."
            }
            if ($validatePointsBeforeRaise) { [void](Get-VshuPointerPoint $element $Operation.element $Operation.x $Operation.y "x" "y" $windowFrame) }
            if (-not $restoreWindow) {
                throw (New-VshuForegroundRefusal $process $pointerNeed $alternative)
            }
            $windowFrame = Restore-VshuPointerWindow $process $handle $root
            $point = Get-VshuPointerPoint $element $Operation.element $Operation.x $Operation.y "x" "y" $windowFrame
            $cursor = Get-VshuCursorPosition
            try {
                Send-VshuMouseClick $point.x $point.y $button $clickCount $Operation.modifiers
            } finally {
                Restore-VshuCursorPosition $cursor
            }
            $action = [pscustomobject]@{ path = "synthetic"; actionName = $null; fallbackReason = "actionUnsupported" }
        }
        "perform_secondary_action" {
            if ($null -eq $element) { throw "unknown element_index" }
            if (-not (Invoke-VshuNamedAction $element $Operation.action)) {
                throw "$($Operation.action) is not a valid secondary action"
            }
            $action = [pscustomobject]@{ path = "accessibility"; actionName = $Operation.action; fallbackReason = $null }
        }
        "scroll" {
            $pages = Get-VshuPositiveNumber $Operation.pages "pages"
            $delta = 120 * [int][Math]::Ceiling($pages)
            $mouseEvent = $MouseEvents.Wheel
            if ($Operation.direction -eq "down") {
                $delta = -1 * $delta
            } elseif ($Operation.direction -eq "left") {
                $mouseEvent = $MouseEvents.HorizontalWheel
                $delta = -1 * $delta
            } elseif ($Operation.direction -eq "right") {
                $mouseEvent = $MouseEvents.HorizontalWheel
            } elseif ($Operation.direction -ne "up") {
                throw "unsupported scroll direction: $($Operation.direction)"
            }
            Assert-VshuElementFound $element $Operation.element
            $scrollTarget = $element
            if ($null -eq $Operation.element) {
                $at = Get-VshuPointerPoint $null $null $Operation.x $Operation.y "x" "y" $windowFrame
                $scrollTarget = Find-VshuScrollContainerAt $root $at.x $at.y ($Operation.direction -in @("up", "down"))
            }
            if (Invoke-VshuScrollPattern $scrollTarget $root $process $Operation.direction $pages) {
                $action = [pscustomobject]@{ path = "accessibility"; actionName = "scroll"; fallbackReason = $null }
                break
            }
            if ($validatePointsBeforeRaise) { [void](Get-VshuPointerPoint $element $Operation.element $Operation.x $Operation.y "x" "y" $windowFrame) }
            if (-not $restoreWindow) {
                $where = if ($null -ne $Operation.element) { "element $($Operation.element.index)" } else { "that point" }
                throw (New-VshuForegroundRefusal $process "nothing under $where scrolls $($Operation.direction) through UI Automation, so this scroll needs the real mouse wheel")
            }
            # Why: the wheel scrolls whatever is under the pointer, so the window must be on top.
            $windowFrame = Restore-VshuPointerWindow $process $handle $root
            $point = Get-VshuPointerPoint $element $Operation.element $Operation.x $Operation.y "x" "y" $windowFrame
            $cursor = Get-VshuCursorPosition
            try {
                [void][VshuDesktopWin32]::SetCursorPos([int]$point.x, [int]$point.y)
                [VshuDesktopWin32]::mouse_event($mouseEvent, 0, 0, $delta, [UIntPtr]::Zero)
            } finally {
                Restore-VshuCursorPosition $cursor
            }
            $fallbackReason = if ($null -ne $Operation.element) { "actionUnsupported" } else { $null }
            $action = [pscustomobject]@{ path = "synthetic"; actionName = "scroll"; fallbackReason = $fallbackReason }
        }
        "drag" {
            Assert-VshuElementFound $fromElement $Operation.fromElement
            Assert-VshuElementFound $toElement $Operation.toElement
            if ($validatePointsBeforeRaise) {
                [void](Get-VshuPointerPoint $fromElement $Operation.fromElement $Operation.from_x $Operation.from_y "from_x" "from_y" $windowFrame)
                [void](Get-VshuPointerPoint $toElement $Operation.toElement $Operation.to_x $Operation.to_y "to_x" "to_y" $windowFrame)
            }
            if (-not $restoreWindow) {
                throw (New-VshuForegroundRefusal $process "a drag needs the real mouse, because UI Automation has no drag")
            }
            $windowFrame = Restore-VshuPointerWindow $process $handle $root
            $from = Get-VshuPointerPoint $fromElement $Operation.fromElement $Operation.from_x $Operation.from_y "from_x" "from_y" $windowFrame
            $to = Get-VshuPointerPoint $toElement $Operation.toElement $Operation.to_x $Operation.to_y "to_x" "to_y" $windowFrame
            $cursor = Get-VshuCursorPosition
            try {
                Send-VshuDrag $from $to
            } finally {
                Restore-VshuCursorPosition $cursor
            }
            $action = [pscustomobject]@{ path = "synthetic"; actionName = "drag"; fallbackReason = $null }
        }
        "type_text" {
            $text = Get-VshuRequiredString $Operation.text "text"
            if ($typesIntoElement) {
                $action = Invoke-VshuElementTextInsertion $element $Operation.element $process $handle $root $Operation $text
            } else {
                Send-VshuText $handle $text
                $action = [pscustomobject]@{ path = "synthetic"; actionName = "typeText"; fallbackReason = $null; verification = [pscustomobject]@{ state = "unverified"; reason = "synthetic_input" } }
            }
        }
        "press_key" {
            Send-VshuKey $handle (Get-VshuRequiredString $Operation.key "key")
            $action = [pscustomobject]@{ path = "synthetic"; actionName = "pressKey"; fallbackReason = $null; verification = [pscustomobject]@{ state = "unverified"; reason = "synthetic_input" } }
        }
        "hotkey" {
            Send-VshuHotkey $handle (Get-VshuRequiredString $Operation.key "key")
            $action = [pscustomobject]@{ path = "synthetic"; actionName = "hotkey"; fallbackReason = $null; verification = [pscustomobject]@{ state = "unverified"; reason = "synthetic_input" } }
        }
        "paste_text" {
            Send-VshuPasteText $handle (Get-VshuRequiredString $Operation.text "text")
            $action = [pscustomobject]@{ path = "clipboard"; actionName = "paste"; fallbackReason = $null; verification = [pscustomobject]@{ state = "unverified"; reason = "clipboard_paste" } }
        }
        "set_value" {
            $written = if ($null -ne $element) { Set-VshuElementValue $element $process ([int]$Operation.element.index) ([string]$Operation.value) } else { $null }
            if ($null -eq $written) {
                throw "element value is not settable"
            }
            $action = [pscustomobject]@{ path = "accessibility"; actionName = "setValue"; fallbackReason = $null }
            if ($null -ne $written.verification) {
                $action | Add-Member -NotePropertyName verification -NotePropertyValue $written.verification
            }
        }
        default {
            throw "unsupported tool: $($Operation.tool)"
        }
    }
    # Why: an app can activate itself and hand the foreground back during the observe, so sample before it too.
    $patternTookForeground = $action.path -eq "accessibility" -and (Test-VshuTargetTookForeground $foregroundBefore $process)

    try {
        try {
            # Why: the observe reads the process and window the input went to, even if the action retitled it.
            $snapshot = New-VshuSnapshot "pid:$($process.Id)" $screenshotRequest ([int64]$handle) $null
        } catch {
            if ($_.Exception.Message -like "window_not_responding:*") { throw }
            # Why: only a target window the action closed may hand the observe to the app's main window.
            if ([VshuDesktopWin32]::IsTargetWindow($handle, [int]$process.Id)) { throw }
            if ($null -eq $action.verification) {
                $action | Add-Member -NotePropertyName verification -NotePropertyValue ([pscustomobject]@{ state = "unverified"; reason = "window_changed" })
            }
            $snapshot = New-VshuSnapshot "pid:$($process.Id)" $screenshotRequest $null $null
        }
    } catch {
        # Why: the input was already sent, so the pre-action "nothing was sent" wording would invite a duplicate retry.
        if ($_.Exception.Message -like "window_not_responding:*") {
            throw "window_not_responding: $(Get-VshuAppName $process) stopped responding after the action was sent; the action may already have been delivered"
        }
        throw
    }
    # Why: real mouse and key input needs the target in front. WPF and others activate their own window for UIA patterns,
    # sometimes after the call returns, so those are measured again once the observe above has given them time.
    $delivery = if ($action.path -eq "accessibility" -and -not $patternTookForeground -and -not (Test-VshuTargetTookForeground $foregroundBefore $process)) { "background" } else { "foreground" }
    $action | Add-Member -NotePropertyName delivery -NotePropertyValue $delivery
    [pscustomobject]@{ ok = $true; action = $action; snapshot = $snapshot }
}

function Invoke-VshuServeLoop {
    # Announce readiness after Add-Type and before reading: absence proves no request ran and permits safe replay.
    # A missing response cannot prove that; replay could duplicate input.
    [Console]::Out.WriteLine('{"ready":true}')
    [Console]::Out.Flush()
    # NDJSON request/response lines may exceed 1 MiB with screenshots; console line IO is memory-bounded.
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $requestId = $null
        try {
            $operation = $line | ConvertFrom-Json
            $requestId = $operation.requestId
            $response = Invoke-VshuOperation $operation
        } catch {
            $response = [pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message }
            # ConvertFrom-Json can fail before reading id; recover it from raw input so the error reaches its request
            # instead of tripping desync cleanup/cooldown and hiding the parse failure.
            if ($null -eq $requestId -and $line -match '"requestId"\s*:\s*(\d+)') {
                $requestId = [long]$Matches[1]
            }
        }
        # Echo id to bind the response; unmatched replies indicate stream desynchronization.
        if ($null -ne $requestId) {
            $response | Add-Member -NotePropertyName requestId -NotePropertyValue $requestId -Force
        }
        [Console]::Out.WriteLine((ConvertTo-Json $response -Depth 100 -Compress))
        [Console]::Out.Flush()
    }
}

if ($Serve) {
    Invoke-VshuServeLoop
} elseif ([string]::IsNullOrWhiteSpace($OperationPath)) {
    Write-VshuJson ([pscustomobject]@{ ok = $false; error = "runtime.ps1 requires an operation path or -Serve" })
} else {
    try {
        $operation = Read-VshuOperation $OperationPath
        Write-VshuJson (Invoke-VshuOperation $operation)
    } catch {
        Write-VshuJson ([pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message })
    }
}
