import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";
import "@babylonjs/loaders/glTF";
import * as Recast from "recast-detour";
import { Engine, Scene, Quaternion, Matrix, SceneLoader, PointerEventTypes, Vector3, HemisphericLight, Mesh, MeshBuilder, FreeCamera, StandardMaterial, Color3, TransformNode, RecastJSPlugin } from "@babylonjs/core";
import { AdvancedDynamicTexture, Button, Control } from "@babylonjs/gui";

class App {

    private _engine;
    private _scene;
    private _canvas;

    private _recast;
    private _crowd;
    private _navigationPlugin;
    private _debugPathLines = [];

    private sceneData = {
        cameraPositions: [
            new Vector3(-6, 4, -8),
            new Vector3(-4, 4, -4),
            new Vector3(-4, 5, -16)
        ]
    }

    constructor() {
        this._main();
    }

    private async _main(): Promise<void> { 

        await this.createEngine();

        this._scene = await this.createScene();

        this.createGUI();

        this._engine.runRenderLoop( () => {
            if (this._scene && this._scene.activeCamera) {
                this._scene.render();
            }
        });

        this._scene.stopAllAnimations();
    }

    private async createEngine() {
        this._canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

        this._engine = new Engine(
            this._canvas,
            true,
            { preserveDrawingBuffer: true, stencil: true }
        );

        this._recast = await Recast.default();
        this._navigationPlugin = new RecastJSPlugin(this._recast);

        window.addEventListener('resize', () => {
            this._engine.resize();
        });
    }

    private async createScene(): Promise<Scene> {
        var scene = new Scene(this._engine);

        scene.fogMode = Scene.FOGMODE_EXP;
        scene.fogDensity = 0.002;
        scene.fogColor = new Color3(0.2, 0.6, 0.9);

        // Create Camera
        var camera = new FreeCamera("camera1", new Vector3(-6, 4, -8), scene);
        camera.setTarget(Vector3.Zero());
        camera.attachControl(this._canvas, true);

        // Create Light
        var light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);
        light.intensity = 0.7;

        // Create Static Mesh
        //var worldMesh = await this.createStaticMesh(scene);
        var worldMeshes = await this.loadEnvironment();

        // Environment post-processing
        scene.materials.forEach((mat) => {
            if (mat.name === "RoomWallMaterial") {
                mat.backFaceCulling = true;
            }
        });
        scene.meshes.forEach((mesh) => {
            if (mesh.name === "RoomWalls") {
                mesh.isPickable = false;
            }
        });

        // Set up navigation
        var agents = [];

        var navmeshParameters = {
            cs: 0.2,
            ch: 0.2,
            walkableSlopeAngle: 90,
            walkableHeight: 1.0,
            walkableClimb: 1,
            walkableRadius: 1,
            maxEdgeLen: 12.,
            maxSimplificationError: 1.3,
            minRegionArea: 8,
            mergeRegionArea: 20,
            maxVertsPerPoly: 6,
            detailSampleDist: 6,
            detailSampleMaxError: 1
        };

        this._navigationPlugin.createNavMesh(worldMeshes, navmeshParameters);
        var navmeshdebug = this._navigationPlugin.createDebugNavMesh(scene);
        navmeshdebug.position = new Vector3(0, 0.01, 0);

        var matdebug = new StandardMaterial('matdebug', scene);
        matdebug.diffuseColor = new Color3(0.1, 0.2, 1);
        matdebug.alpha = 0.2;
        navmeshdebug.material = matdebug;

        // crowd
        this._crowd = this._navigationPlugin.createCrowd(10, 0.1, scene);
        var i;
        var agentParams = {
            radius: 0.1,
            reachRadius: 0.2, // radius * 2?
            height: 0.2,
            maxAcceleration: 5.0,
            maxSpeed: 0.9,
            collisionQueryRange: 0.5,
            pathOptimizationRange: 0.0,
            separationWeight: 1.0
        };

        for (i = 0; i < 5; i++) {
            //var agentCube = MeshBuilder.CreateBox("cube", { size: width, height: width }, scene);
            var agentCube: Mesh;
            if (i==0) {
                //var agentCube = MeshBuilder.CreateCapsule("agent" + i, { radius: 0.3, height: 1.5, tessellation: 16, capSubdivisions: 2 }, scene);
                agentCube = await this.loadHuman();
                console.log("human", agentCube)
            } else {
                agentCube = MeshBuilder.CreateCapsule("agent" + i, { radius: 0.3, height: 1.5, tessellation: 16, capSubdivisions: 2 }, scene);
                var matAgent = new StandardMaterial('mat2', scene);
                const variation = Math.random();
                matAgent.diffuseColor = new Color3(0.4 + variation * 0.6, 0.3, 1.0 - variation * 0.3);
                agentCube.material = matAgent;
            }
            
            const targetCube = MeshBuilder.CreateBox("targetcube" + i, { size: 0.1, height: 0.1 }, scene);
            const randomPos = this._navigationPlugin.getRandomPointAround(new Vector3(-2.0, 0.1, -1.8), 0.5);
            const transform = new TransformNode("transform" + i);
            //agentCube.parent = transform;
            var agentIndex = this._crowd.addAgent(randomPos, agentParams, transform);
            agents.push({ idx: agentIndex, trf: transform, mesh: agentCube, target: targetCube });
        }    

        this._crowd.onReachTargetObservable.add((agentInfos) => {
            // TODO: Ensure that reachRadius is correctly set
            if (agentInfos.agentIndex == 0) {
                console.log("Player reached destination: ", agentInfos);

                // Stop player animations
                this._scene.stopAllAnimations();
                
                // Change camera position depending on player position
                var playerPos = this._crowd.getAgentPosition(0);
                if (playerPos._z < -5) {
                    this._scene.activeCamera.position = this.sceneData.cameraPositions[2];
                } else if (playerPos._x > 0 && playerPos._z > 0) {
                    this._scene.activeCamera.position = this.sceneData.cameraPositions[1];
                } else {
                    this._scene.activeCamera.position = this.sceneData.cameraPositions[0];
                }
                camera.setTarget(Vector3.Zero());

            } else {
                window.setTimeout(() => {
                    var randomPos = this._navigationPlugin.getRandomPointAround(new Vector3(-2.0, 0.1, -1.8), 0.5);
                    this._crowd.agentGoto(agentInfos.agentIndex, randomPos);
                }, Math.random() * 3000);
            }
        });

        // Send off agents
        window.setTimeout(() => {
            for (var i=1; i<agents.length; i++) {
                var randomPos = this._navigationPlugin.getRandomPointAround(new Vector3(-2.0, 0.1, -1.8), 0.5);
                this._crowd.agentGoto(agents[i].idx, randomPos);
            }
        }, 1000);

        
        scene.onPointerObservable.add((pointerInfo) => {
            switch (pointerInfo.type) {
                case PointerEventTypes.POINTERDOWN:
                    if (pointerInfo.pickInfo.hit) {
                        console.log("pointer down", pointerInfo.pickInfo.pickedMesh.name);
                        this.pointerDown(pointerInfo.pickInfo.pickedMesh)
                    }
                    break;
            }
        });

        scene.onBeforeRenderObservable.add(() => {

            // Move and rotate agents
            for (let i = 0; i < agents.length; i++) {
                var ag = agents[i];
                ag.mesh.position = this._crowd.getAgentPosition(ag.idx);
                let vel = this._crowd.getAgentVelocity(ag.idx);
                this._crowd.getAgentNextTargetPathToRef(ag.idx, ag.target.position);
                if (vel.length() > 0.2) {
                    vel.normalize();
                    var desiredRotation = Math.atan2(vel.x, vel.z);
                    ag.mesh.rotation.y = ag.mesh.rotation.y + (desiredRotation - ag.mesh.rotation.y) * 0.05;
                }
            }
        });

        return scene;
    }

    private createGUI() {
        // GUI
        var advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("UI");

        var debugButton = Button.CreateSimpleButton("debugButton", "Show Debug");
        debugButton.onPointerClickObservable.add((value) => {
            if (this._scene.debugLayer.isVisible()) {
                this._scene.debugLayer.hide();
                debugButton.textBlock.text = "Show Debug";
            } else {
                this._scene.debugLayer.show();
                debugButton.textBlock.text = "Hide Debug";
            }
        });
        debugButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;

        var fullscreenButton = Button.CreateSimpleButton("fullScreenButton", "Enter Fullscreen");
        fullscreenButton.onPointerClickObservable.add((value) => {
            if (this._engine.isFullscreen) {
                this._engine.exitFullscreen();
                fullscreenButton.textBlock.text = "Enter Fullscreen";
            } else {
                this._engine.enterFullscreen(true);
                fullscreenButton.textBlock.text = "Exit Fullscreen";
            }
        });
        fullscreenButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;

        var buttons: Button[] = [
            debugButton,
            fullscreenButton
        ];

        buttons.forEach((button, index) => {
            button.width = 0.2;
            button.height = "30px";
            button.color = "white";
            button.background = "black";
            button.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;

            advancedTexture.addControl(button); 
        });
    }

    private async loadHuman(): Promise<Mesh> {
        //collision mesh
        //const outer = MeshBuilder.CreateBox("outer", { width: 2, depth: 1, height: 3 }, this._scene);
        const outer = MeshBuilder.CreateCapsule("playerOuterMesh", { radius: 0.3, height: 1.5, tessellation: 16, capSubdivisions: 2 }, this._scene);
        outer.isVisible = false;
        outer.isPickable = false;
        outer.checkCollisions = true;

        //move origin of box collider to the bottom of the mesh (to match player mesh)
        outer.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0))

        //outer.rotationQuaternion = new Quaternion(0, 1, 0, 0); // rotate the player mesh 180 since we want to see the back of the player

        const result = await SceneLoader.ImportMeshAsync(null, "./models/", "human1.glb", this._scene);
        const root = result.meshes[0];

        root.parent = outer;
        root.isPickable = false;
        root.getChildMeshes().forEach(m => {
            m.isPickable = false;
        })

        return  outer as Mesh;
    }

    private async loadEnvironment() {
        const result = await SceneLoader.ImportMeshAsync(null, "./models/", "office.glb", this._scene);

        return [result.meshes[1], result.meshes[2], result.meshes[3]];
    }

    private async createStaticMesh(scene) {
        var ground = Mesh.CreateGround("ground1", 8, 8, 2, scene);

        // Materials
        var mat1 = new StandardMaterial('mat1', scene);
        mat1.diffuseColor = new Color3(1, 1, 1);
        var mat2 = new StandardMaterial('mat2', scene);
        mat2.diffuseColor = new Color3(0, 1, 1);

        var sphere = MeshBuilder.CreateSphere("sphere1", { diameter: 1, segments: 16 }, scene);
        sphere.material = mat1;
        sphere.position.y = 0;

        var cube1 = MeshBuilder.CreateBox("cube1", { size: 1, height: 2 }, scene);
        cube1.position = new Vector3(1, 0.5, -2);
        cube1.material = mat2;

        var cube2 = MeshBuilder.CreateBox("cube2", { size: 1, height: 1 }, scene);
        cube2.position = new Vector3(-2, 0.5, 2);
        cube2.material = mat2;

        var mesh = Mesh.MergeMeshes([sphere, cube1, cube2, ground]);
        return mesh;
    }

    private getGroundPosition() {
        var pickinfo = this._scene.pick(this._scene.pointerX, this._scene.pointerY);
        if (pickinfo.hit) {
            return pickinfo.pickedPoint;
        }

        return null;
    }

    public pointerDown (mesh) {
        var startingPoint;
        var camera = this._scene.activeCamera;
        var canvas = this._scene.getEngine().getRenderingCanvas();

        startingPoint = this.getGroundPosition();

        console.log("pointerDown", startingPoint);

        if (startingPoint) { // we need to disconnect camera from canvas
            setTimeout(function () {
                camera.detachControl(canvas);
            }, 0);
            var agents = this._crowd.getAgents();
            var i;

            for (i = 0; i < 1; i++) {
               // var randomPos = this._navigationPlugin.getRandomPointAround(startingPoint, 1.0);
                this._crowd.agentGoto(agents[i], this._navigationPlugin.getClosestPoint(startingPoint));

                var pathPoints = this._navigationPlugin.computePath(this._crowd.getAgentPosition(agents[i]), this._navigationPlugin.getClosestPoint(startingPoint));
                this._debugPathLines[i] = MeshBuilder.CreateDashedLines("ribbon", { points: pathPoints, updatable: true, instance: this._debugPathLines[i], }, this._scene);
            }

            console.log("SCENE", this._scene);
            this._scene.animationGroups.forEach((group) => {
                group.loopAnimation = true;
                group.play(true);
            });
        }
    }
}
new App();