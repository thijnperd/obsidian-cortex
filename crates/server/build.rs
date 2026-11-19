fn main() {
    // The Explorer/taskbar icon comes from the exe resource, not from the
    // window builder. Only Windows has that concept.
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=../../assets/icons/cortex.ico");
        let mut resource = winres::WindowsResource::new();
        resource.set_icon("../../assets/icons/cortex.ico");
        resource.set("ProductName", "Cortex");
        resource.set("FileDescription", "Cortex — a local-first Markdown vault");
        resource.compile().expect("embed the Cortex icon");
    }
}
